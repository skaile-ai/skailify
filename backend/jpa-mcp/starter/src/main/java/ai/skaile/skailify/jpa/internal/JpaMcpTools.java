// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.server.McpStatelessServerFeatures.SyncToolSpecification;
import io.modelcontextprotocol.spec.McpSchema.CallToolResult;
import io.modelcontextprotocol.spec.McpSchema.Tool;
import io.modelcontextprotocol.spec.McpSchema.ToolAnnotations;
import java.io.IOException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The MCP tools: {@code describe_model}, and {@code list_}, {@code get_} and {@code query_} per
 * exposed entity. Every tool is read-only, says so in its annotations, and carries its Skaile
 * action metadata at {@code _meta["ai.skaile/action"]}.
 */
public final class JpaMcpTools {

    public static final String DESCRIBE_TOOL = "describe_model";

    private static final Logger log = LoggerFactory.getLogger(JpaMcpTools.class);

    private final EntityCatalog catalog;
    private final EntityQueries queries;
    private final McpJsonMapper json;

    public JpaMcpTools(EntityCatalog catalog, EntityQueries queries, McpJsonMapper json) {
        this.catalog = catalog;
        this.queries = queries;
        this.json = json;
    }

    public List<SyncToolSpecification> specifications() {
        List<SyncToolSpecification> specs = new ArrayList<>();
        specs.add(spec(
                tool(DESCRIBE_TOOL,
                        "Describe the app's data model: the record types an agent can read, their attributes, the "
                                + "filters each attribute takes and the tools that read them. Call it first.",
                        objectSchema(new LinkedHashMap<>(), List.of()),
                        ActionMeta.DESCRIBE),
                args -> {
                    rejectAny(args);
                    return describe();
                }));
        for (ExposedEntity entity : catalog.entities()) {
            specs.add(spec(
                    tool(entity.listTool(),
                            "List " + entity.name() + " records, " + queries.defaultLimit() + " at a time (at most "
                                    + queries.maxLimit() + "); page with offset while hasMore is true. "
                                    + entity.description(),
                            objectSchema(pageProperties(entity), List.of()),
                            entity.action()),
                    args -> queries.list(entity, args)));
            if (entity.id() != null) {
                Map<String, Object> idProps = new LinkedHashMap<>();
                idProps.put("id", withDescription(ValueCodec.schemaOf(entity.id().valueType()),
                        "The record's " + entity.id().name()));
                specs.add(spec(
                        tool(entity.getTool(),
                                "Read one " + entity.name() + " record by its " + entity.id().name() + ". "
                                        + entity.description(),
                                objectSchema(idProps, List.of("id")),
                                entity.action()),
                        args -> {
                            Map<String, Object> item = queries.get(entity, args);
                            if (item == null) {
                                throw new ToolInputException("no " + entity.name() + " with " + entity.id().name()
                                        + " " + args.get("id"));
                            }
                            Map<String, Object> result = new LinkedHashMap<>();
                            result.put("entity", entity.name());
                            result.put("item", item);
                            return result;
                        }));
            }
            Map<String, Object> queryProps = pageProperties(entity);
            queryProps.put("where", whereSchema(entity));
            specs.add(spec(
                    tool(entity.queryTool(),
                            "Find " + entity.name() + " records whose attributes match filters, sorted and paged. "
                                    + "where maps an attribute to a value (equals) or to operators such as "
                                    + "{\"gte\": 10}; all conditions must hold. " + entity.description(),
                            objectSchema(queryProps, List.of()),
                            entity.action()),
                    args -> queries.query(entity, args)));
        }
        return specs;
    }

    private Map<String, Object> describe() {
        List<Map<String, Object>> entities = new ArrayList<>();
        for (ExposedEntity entity : catalog.entities()) {
            Map<String, Object> e = new LinkedHashMap<>();
            e.put("name", entity.name());
            e.put("description", entity.description());
            Map<String, Object> tools = new LinkedHashMap<>();
            tools.put("list", entity.listTool());
            if (entity.id() != null) tools.put("get", entity.getTool());
            tools.put("query", entity.queryTool());
            e.put("tools", tools);
            if (entity.id() != null) e.put("id", entity.id().name());
            List<Map<String, Object>> attributes = new ArrayList<>();
            for (ExposedAttribute attribute : entity.attributes()) {
                Map<String, Object> a = new LinkedHashMap<>();
                a.put("name", attribute.name());
                a.put("schema", ValueCodec.schemaOf(attribute.valueType()));
                if (attribute.reference()) a.put("references", attribute.referenceTo());
                a.put("filters", EntityQueries.operators(attribute));
                a.put("sortable", attribute.sortable());
                attributes.add(a);
            }
            e.put("attributes", attributes);
            entities.add(e);
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("entities", entities);
        result.put("notes", "References are served as {\"entity\", \"id\"}; read the referenced record with its get "
                + "tool. Values are JSON; dates and times are ISO-8601 strings.");
        return result;
    }

    private Map<String, Object> pageProperties(ExposedEntity entity) {
        Map<String, Object> props = new LinkedHashMap<>();
        Map<String, Object> limit = new LinkedHashMap<>();
        limit.put("type", "integer");
        limit.put("minimum", 1);
        limit.put("maximum", queries.maxLimit());
        limit.put("description", "Records per page, default " + queries.defaultLimit());
        props.put("limit", limit);
        Map<String, Object> offset = new LinkedHashMap<>();
        offset.put("type", "integer");
        offset.put("minimum", 0);
        offset.put("description", "Records to skip, default 0");
        props.put("offset", offset);
        List<String> sortable = entity.sortable().stream().map(ExposedAttribute::name).toList();
        if (!sortable.isEmpty()) {
            Map<String, Object> orderBy = new LinkedHashMap<>();
            orderBy.put("type", "string");
            orderBy.put("enum", sortable);
            orderBy.put("description", entity.id() != null && entity.id().sortable()
                    ? "Attribute to sort by, default " + entity.id().name()
                    : "Attribute to sort by");
            props.put("orderBy", orderBy);
        }
        Map<String, Object> direction = new LinkedHashMap<>();
        direction.put("type", "string");
        direction.put("enum", List.of("asc", "desc"));
        direction.put("description", "Sort direction, default asc");
        props.put("direction", direction);
        return props;
    }

    private static Map<String, Object> whereSchema(ExposedEntity entity) {
        Map<String, Object> props = new LinkedHashMap<>();
        for (ExposedAttribute attribute : entity.attributes()) {
            Map<String, Object> scalar = ValueCodec.schemaOf(attribute.valueType());
            Map<String, Object> ops = new LinkedHashMap<>();
            for (String op : EntityQueries.operators(attribute)) {
                ops.put(op, switch (op) {
                    case "in" -> Map.of("type", "array", "items", scalar, "minItems", 1,
                            "maxItems", EntityQueries.MAX_IN_VALUES);
                    case "isNull" -> Map.of("type", "boolean");
                    case "contains", "startsWith" -> Map.of("type", "string");
                    default -> scalar;
                });
            }
            Map<String, Object> opsSchema = objectSchema(ops, List.of());
            opsSchema.put("minProperties", 1);
            Map<String, Object> condition = new LinkedHashMap<>();
            condition.put("anyOf", List.of(scalar, opsSchema));
            if (attribute.reference()) {
                condition.put("description", "The id of the referenced " + attribute.referenceTo());
            }
            props.put(attribute.name(), condition);
        }
        Map<String, Object> where = objectSchema(props, List.of());
        where.put("description", "Conditions on attributes; all must hold. Text matches ignore case.");
        return where;
    }

    private static Map<String, Object> objectSchema(Map<String, Object> properties, List<String> required) {
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("properties", properties);
        if (!required.isEmpty()) schema.put("required", required);
        schema.put("additionalProperties", false);
        return schema;
    }

    private static Map<String, Object> withDescription(Map<String, Object> schema, String description) {
        Map<String, Object> copy = new LinkedHashMap<>(schema);
        copy.put("description", description);
        return copy;
    }

    private static Tool tool(String name, String description, Map<String, Object> inputSchema, ActionMeta action) {
        return Tool.builder()
                .name(name)
                .description(description)
                .inputSchema(inputSchema)
                .annotations(ToolAnnotations.builder()
                        .readOnlyHint(true)
                        .destructiveHint(false)
                        .idempotentHint(true)
                        .openWorldHint(false)
                        .build())
                .meta(action.toToolMeta())
                .build();
    }

    private SyncToolSpecification spec(Tool tool, Function<Map<String, Object>, Map<String, Object>> handler) {
        return SyncToolSpecification.builder()
                .tool(tool)
                .callHandler((context, request) -> {
                    Map<String, Object> args = request.arguments() == null ? Map.of() : request.arguments();
                    try {
                        return ok(handler.apply(args));
                    } catch (ToolInputException e) {
                        return error(e.getMessage());
                    } catch (RuntimeException e) {
                        log.warn("{} failed", tool.name(), e);
                        return error(tool.name() + " failed; the server log has the details");
                    }
                })
                .build();
    }

    private CallToolResult ok(Map<String, Object> result) {
        String text;
        try {
            text = json.writeValueAsString(result);
        } catch (IOException e) {
            throw new IllegalStateException("cannot write a tool result as JSON", e);
        }
        return CallToolResult.builder().addTextContent(text).structuredContent(result).isError(false).build();
    }

    private static CallToolResult error(String message) {
        return CallToolResult.builder().addTextContent(message).isError(true).build();
    }

    private static void rejectAny(Map<String, Object> args) {
        if (!args.isEmpty()) throw new ToolInputException("this tool takes no arguments");
    }
}
