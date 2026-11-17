// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.skaile.skailify.jpa.fixture.FixtureApp;
import ai.skaile.skailify.jpa.internal.EntityCatalog;
import ai.skaile.skailify.jpa.internal.EntityQueries;
import ai.skaile.skailify.jpa.internal.ExposedEntity;
import ai.skaile.skailify.jpa.internal.ToolInputException;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import io.modelcontextprotocol.spec.McpSchema.TextContent;
import io.modelcontextprotocol.spec.McpSchema.Tool;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

/** The starter end to end: a real MCP client over streamable HTTP against the fixture app. */
@SpringBootTest(
        classes = FixtureApp.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "skailify.mcp.allow-unauthenticated=true")
class JpaMcpServerTest {

    @LocalServerPort
    int port;

    @Autowired
    EntityCatalog catalog;

    @Autowired
    EntityQueries queries;

    private McpSyncClient client;

    private McpSyncClient client(Map<String, String> headers) {
        HttpClientStreamableHttpTransport.Builder transport =
                HttpClientStreamableHttpTransport.builder("http://127.0.0.1:" + port).endpoint("/mcp");
        if (!headers.isEmpty()) {
            java.net.http.HttpRequest.Builder request = java.net.http.HttpRequest.newBuilder();
            headers.forEach(request::header);
            transport.requestBuilder(request);
        }
        client = McpClient.sync(transport.build()).build();
        client.initialize();
        return client;
    }

    @AfterEach
    void close() {
        if (client != null) client.closeGracefully();
    }

    private Map<String, Tool> tools() {
        return client(Map.of()).listTools().tools().stream().collect(Collectors.toMap(Tool::name, t -> t));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> structured(CallToolResult result) {
        assertThat(result.isError()).as(text(result)).isFalse();
        return (Map<String, Object>) result.structuredContent();
    }

    private static String text(CallToolResult result) {
        return ((TextContent) result.content().get(0)).text();
    }

    private CallToolResult call(String tool, Map<String, Object> args) {
        if (client == null) client(Map.of());
        return client.callTool(new CallToolRequest(tool, args));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> items(Map<String, Object> page) {
        return (List<Map<String, Object>>) page.get("items");
    }

    @Test
    void servesReadToolsForExposedEntitiesOnly() {
        assertThat(tools().keySet())
                .containsExactlyInAnyOrder(
                        "describe_model", "list_author", "get_author", "query_author",
                        "list_book", "get_book", "query_book");
    }

    @Test
    void everyToolIsReadOnlyWithValidActionMetadata() {
        for (Tool tool : tools().values()) {
            assertThat(tool.annotations().readOnlyHint()).as(tool.name()).isTrue();
            assertThat(tool.annotations().destructiveHint()).as(tool.name()).isFalse();
            assertThat(tool.description()).as(tool.name()).isNotBlank();
            assertThat(tool.meta()).as(tool.name()).containsOnlyKeys("ai.skaile/action");
            Map<?, ?> action = (Map<?, ?>) tool.meta().get("ai.skaile/action");
            assertThat(action.get("effect")).isEqualTo("routine");
            assertThat(action.get("idempotent")).isEqualTo(true);
        }
    }

    @Test
    void actionMetadataComesFromTheAnnotation() {
        Map<String, Tool> tools = tools();
        assertThat(tools.get("query_book").meta().get("ai.skaile/action"))
                .isEqualTo(Map.of("effect", "routine", "risk", "medium", "idempotent", true, "minTier", "User",
                        "disclosure", "owner-private"));
        assertThat(tools.get("get_author").meta().get("ai.skaile/action"))
                .isEqualTo(Map.of("effect", "routine", "risk", "low", "idempotent", true,
                        "disclosure", "session-visible"));
        assertThat(tools.get("describe_model").meta().get("ai.skaile/action"))
                .isEqualTo(Map.of("effect", "routine", "risk", "low", "idempotent", true,
                        "disclosure", "session-visible"));
    }

    @Test
    void describeModelListsServedAttributesOnly() {
        Map<String, Object> model = structured(call("describe_model", Map.of()));
        List<Map<String, Object>> entities = (List<Map<String, Object>>) model.get("entities");
        Map<String, Object> book = entities.stream().filter(e -> e.get("name").equals("book")).findFirst().orElseThrow();
        List<String> attributes = ((List<Map<String, Object>>) book.get("attributes"))
                .stream().map(a -> (String) a.get("name")).toList();
        // cover (byte[]), shelf (not exposed) and related (a collection) are left out; id comes first.
        assertThat(attributes).containsExactly("id", "author", "genre", "price", "published", "tenant", "title");
        Map<String, Object> author = entities.stream().filter(e -> e.get("name").equals("author")).findFirst().orElseThrow();
        assertThat(author.toString()).doesNotContain("email");
    }

    @Test
    void listPagesInIdOrder() {
        Map<String, Object> first = structured(call("list_book", Map.of()));
        assertThat(items(first)).extracting(i -> i.get("id")).containsExactly(1, 2);
        assertThat(first.get("hasMore")).isEqualTo(true);
        Map<String, Object> last = structured(call("list_book", Map.of("offset", 2, "limit", 3)));
        assertThat(items(last)).extracting(i -> i.get("id")).containsExactly(3, 4);
        assertThat(last.get("hasMore")).isEqualTo(false);
    }

    @Test
    void getReturnsOneRecordWithReferencesAsIds() {
        Map<String, Object> result = structured(call("get_book", Map.of("id", 1)));
        Map<String, Object> book = (Map<String, Object>) result.get("item");
        assertThat(book.get("title")).isEqualTo("The First Novel");
        assertThat(book.get("genre")).isEqualTo("NOVEL");
        assertThat(book.get("published")).isEqualTo("2020-01-15");
        assertThat(book.get("author")).isEqualTo(Map.of("entity", "author", "id", 1));
        assertThat(book).doesNotContainKeys("shelf", "cover", "related");
    }

    @Test
    void getLeavesHiddenAttributesOut() {
        Map<String, Object> author = (Map<String, Object>) structured(call("get_author", Map.of("id", 1))).get("item");
        assertThat(author).containsOnlyKeys("id", "name");
    }

    @Test
    void getOfAMissingRecordIsAToolError() {
        CallToolResult result = call("get_book", Map.of("id", 99));
        assertThat(result.isError()).isTrue();
        assertThat(text(result)).contains("no book with id 99");
    }

    @Test
    void queryFiltersSortsAndCombinesConditions() {
        Map<String, Object> page = structured(call("query_book", Map.of(
                "where", Map.of("genre", Map.of("in", List.of("NOVEL", "ESSAY")), "price", Map.of("lt", 10)),
                "limit", 3)));
        assertThat(items(page)).extracting(i -> i.get("id")).containsExactly(2);

        Map<String, Object> sorted = structured(call("query_book", Map.of(
                "where", Map.of("price", Map.of("isNull", false)), "orderBy", "price", "direction", "desc",
                "limit", 3)));
        assertThat(items(sorted)).extracting(i -> i.get("id")).containsExactly(3, 1, 2);
    }

    @Test
    void queryOnAReferenceMatchesTheReferencedId() {
        Map<String, Object> page = structured(call("query_book", Map.of("where", Map.of("author", 2))));
        assertThat(items(page)).extracting(i -> i.get("id")).containsExactly(3);
        Map<String, Object> orphans = structured(call("query_book", Map.of("where", Map.of("author", Map.of("isNull", true)))));
        assertThat(items(orphans)).extracting(i -> i.get("id")).containsExactly(4);
    }

    @Test
    void textMatchesIgnoreCaseAndTreatWildcardsLiterally() {
        Map<String, Object> page = structured(call("query_book", Map.of("where", Map.of("title", Map.of("contains", "NOVEL")))));
        assertThat(items(page)).extracting(i -> i.get("id")).containsExactly(1);
        Map<String, Object> literal = structured(call("query_author", Map.of("where", Map.of("name", Map.of("contains", "100%")))));
        assertThat(items(literal)).extracting(i -> i.get("id")).containsExactly(2);
        Map<String, Object> none = structured(call("query_author", Map.of("where", Map.of("name", Map.of("contains", "e_N")))));
        assertThat(items(none)).isEmpty();
    }

    @Test
    void hiddenAttributesCannotBeFilteredOn() {
        CallToolResult result = call("query_author", Map.of("where", Map.of("email", "ann@example.org")));
        assertThat(result.isError()).isTrue();
        // The input schema already refuses it; the server checks again behind it.
        assertThat(text(result)).contains("email");
    }

    @Test
    void badArgumentsAreToolErrorsNamingTheArgument() {
        assertThat(text(call("list_book", Map.of("limit", 50)))).contains("limit").contains("3");
        assertThat(text(call("query_book", Map.of("where", Map.of("genre", "SCIFI"))))).contains("genre");
        assertThat(text(call("query_book", Map.of("where", Map.of("genre", Map.of("gt", "NOVEL")))))).contains("genre");
        assertThat(text(call("list_book", Map.of("orderBy", "author")))).contains("orderBy");
        assertThat(text(call("get_book", Map.of("id", "x")))).contains("id");
    }

    /** The same checks behind the input schema, for a client that bypasses it. */
    @Test
    void theServerChecksArgumentsItselfToo() {
        ExposedEntity book = catalog.entities().stream().filter(e -> e.name().equals("book")).findFirst().orElseThrow();
        assertThatThrownBy(() -> queries.list(book, Map.of("limit", 50)))
                .isInstanceOf(ToolInputException.class).hasMessageContaining("limit: must be between 1 and 3");
        assertThatThrownBy(() -> queries.query(book, Map.of("where", Map.of("genre", "SCIFI"))))
                .hasMessageContaining("is not one of");
        assertThatThrownBy(() -> queries.query(book, Map.of("where", Map.of("genre", Map.of("gt", "NOVEL")))))
                .hasMessageContaining("genre is not ordered");
        assertThatThrownBy(() -> queries.query(book, Map.of("where", Map.of("shelf", 1))))
                .hasMessageContaining("where.shelf: no such attribute");
        assertThatThrownBy(() -> queries.query(book, Map.of("where", Map.of("title", Map.of("like", "%")))))
                .hasMessageContaining("unknown operator");
        assertThatThrownBy(() -> queries.list(book, Map.of("orderBy", "author")))
                .hasMessageContaining("not a sortable attribute");
        assertThatThrownBy(() -> queries.list(book, Map.of("select", "*")))
                .hasMessageContaining("unknown argument");
        assertThatThrownBy(() -> queries.get(book, Map.of("id", "x")))
                .hasMessageContaining("id: expected a number");
    }

    @Test
    void readFiltersRunWithTheCallersRequestContext() {
        client(Map.of("X-Tenant", "t2"));
        Map<String, Object> page = structured(call("list_book", Map.of("limit", 3)));
        assertThat(items(page)).extracting(i -> i.get("id")).containsExactly(3, 4);
        CallToolResult hidden = call("get_book", Map.of("id", 1));
        assertThat(hidden.isError()).isTrue();
    }
}
