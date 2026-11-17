// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.example;

import static org.assertj.core.api.Assertions.assertThat;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import io.modelcontextprotocol.spec.McpSchema.CallToolRequest;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import io.modelcontextprotocol.spec.McpSchema.Tool;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ShopApplicationTest {

    @LocalServerPort
    int port;

    @Test
    @SuppressWarnings("unchecked")
    void servesTheShopReadOnly() {
        McpSyncClient client = McpClient.sync(HttpClientStreamableHttpTransport.builder("http://127.0.0.1:" + port)
                        .endpoint("/mcp")
                        .build())
                .build();
        try {
            client.initialize();
            List<String> tools = client.listTools().tools().stream().map(Tool::name).toList();
            assertThat(tools).containsExactlyInAnyOrder(
                    "describe_model",
                    "list_customer", "get_customer", "query_customer",
                    "list_order", "get_order", "query_order",
                    "list_product", "get_product", "query_product");

            CallToolResult open = client.callTool(new CallToolRequest(
                    "query_order", Map.of("where", Map.of("status", "OPEN", "customer", 1))));
            List<Map<String, Object>> items =
                    (List<Map<String, Object>>) ((Map<String, Object>) open.structuredContent()).get("items");
            assertThat(items).extracting(i -> i.get("id")).containsExactly(2);

            CallToolResult ada = client.callTool(new CallToolRequest("get_customer", Map.of("id", 1)));
            assertThat(((Map<String, Object>) ada.structuredContent()).get("item").toString())
                    .contains("Ada Lovelace")
                    .doesNotContain("prefers email");
        } finally {
            client.closeGracefully();
        }
    }
}
