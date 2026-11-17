// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.autoconfigure;

import ai.skaile.skailify.jpa.SkailifyReadFilter;
import ai.skaile.skailify.jpa.internal.EntityCatalog;
import ai.skaile.skailify.jpa.internal.EntityQueries;
import ai.skaile.skailify.jpa.internal.JpaMcpTools;
import ai.skaile.skailify.jpa.internal.PreviewAuthorizationFilter;
import io.modelcontextprotocol.json.McpJsonMapper;
import io.modelcontextprotocol.json.jackson3.JacksonMcpJsonMapper;
import io.modelcontextprotocol.server.McpServer;
import io.modelcontextprotocol.server.McpStatelessServerFeatures.SyncToolSpecification;
import io.modelcontextprotocol.server.McpStatelessSyncServer;
import io.modelcontextprotocol.server.transport.HttpServletStatelessServerTransport;
import io.modelcontextprotocol.spec.McpSchema.ServerCapabilities;
import jakarta.persistence.EntityManagerFactory;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ListableBeanFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBooleanProperty;
import org.springframework.boot.autoconfigure.condition.ConditionalOnSingleCandidate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import tools.jackson.databind.json.JsonMapper;

/**
 * Serves the entities marked {@code @SkailifyEntity} as read-only MCP tools on a stateless,
 * streamable HTTP endpoint ({@code skailify.mcp.path}, default {@code /mcp}).
 */
@AutoConfiguration(
        afterName = {
            "org.springframework.boot.hibernate.autoconfigure.HibernateJpaAutoConfiguration",
            "org.springframework.boot.autoconfigure.orm.jpa.HibernateJpaAutoConfiguration"
        })
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnSingleCandidate(EntityManagerFactory.class)
@ConditionalOnBooleanProperty(name = "skailify.mcp.enabled", matchIfMissing = true)
@EnableConfigurationProperties(SkailifyJpaMcpProperties.class)
public class SkailifyJpaMcpAutoConfiguration {

    private static final Logger log = LoggerFactory.getLogger(SkailifyJpaMcpAutoConfiguration.class);

    /** The bean Spring Security registers for its filter chain. */
    static final String SECURITY_FILTER_CHAIN = "springSecurityFilterChain";

    @Bean
    EntityCatalog skailifyEntityCatalog(EntityManagerFactory emf) {
        EntityCatalog catalog = EntityCatalog.from(emf.getMetamodel());
        if (catalog.entities().isEmpty()) {
            log.warn("Skailify MCP: no entity is annotated with @SkailifyEntity; only describe_model is served");
        }
        return catalog;
    }

    @Bean
    EntityQueries skailifyEntityQueries(
            EntityManagerFactory emf, ObjectProvider<SkailifyReadFilter> filters, SkailifyJpaMcpProperties properties) {
        return new EntityQueries(
                emf,
                filters.orderedStream().toList(),
                properties.getDefaultLimit(),
                properties.getMaxLimit(),
                properties.getQueryTimeoutMs());
    }

    @Bean
    HttpServletStatelessServerTransport skailifyMcpTransport(SkailifyJpaMcpProperties properties) {
        return HttpServletStatelessServerTransport.builder()
                .jsonMapper(mcpJsonMapper())
                .messageEndpoint(properties.getPath())
                .build();
    }

    @Bean(destroyMethod = "close")
    McpStatelessSyncServer skailifyMcpServer(
            HttpServletStatelessServerTransport transport,
            EntityCatalog catalog,
            EntityQueries queries,
            SkailifyJpaMcpProperties properties) {
        McpJsonMapper json = mcpJsonMapper();
        List<SyncToolSpecification> specs = new JpaMcpTools(catalog, queries, json).specifications();
        McpStatelessSyncServer server = McpServer.sync(transport)
                .serverInfo(properties.getServerName(), properties.getServerVersion())
                .instructions(properties.getInstructions())
                .capabilities(ServerCapabilities.builder().tools(false).build())
                .jsonMapper(json)
                // Run handlers on the request thread, so a SkailifyReadFilter sees the caller's security context.
                .immediateExecution(true)
                .tools(specs)
                .build();
        log.info("Skailify MCP: serving {} read-only tools for {} entities at {}",
                specs.size(), catalog.entities().size(), properties.getPath());
        return server;
    }

    @Bean
    ServletRegistrationBean<HttpServletStatelessServerTransport> skailifyMcpServlet(
            HttpServletStatelessServerTransport transport,
            McpStatelessSyncServer server,
            SkailifyJpaMcpProperties properties) {
        ServletRegistrationBean<HttpServletStatelessServerTransport> registration =
                new ServletRegistrationBean<>(transport, properties.getPath());
        registration.setName("skailifyMcp");
        registration.setAsyncSupported(true);
        return registration;
    }

    @Bean
    @ConditionalOnBooleanProperty(name = "skailify.mcp.preview-authorization", matchIfMissing = true)
    FilterRegistrationBean<PreviewAuthorizationFilter> skailifyPreviewAuthorizationFilter(
            SkailifyJpaMcpProperties properties) {
        FilterRegistrationBean<PreviewAuthorizationFilter> registration =
                new FilterRegistrationBean<>(new PreviewAuthorizationFilter());
        registration.addUrlPatterns(properties.getPath(), properties.getPath() + "/*");
        // Before Spring Security's filter chain (order -100 by default).
        registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 10);
        registration.setName("skailifyPreviewAuthorization");
        return registration;
    }

    /** Refuses to start an unprotected endpoint unless {@code skailify.mcp.allow-unauthenticated} says so. */
    @Bean
    static SmartInitializingSingleton skailifyAuthenticationGuard(
            ListableBeanFactory beans, ObjectProvider<SkailifyJpaMcpProperties> properties) {
        return () -> {
            SkailifyJpaMcpProperties p = properties.getObject();
            if (beans.containsBean(SECURITY_FILTER_CHAIN)) return;
            if (!p.isAllowUnauthenticated()) {
                throw new IllegalStateException("Skailify MCP: the app has no Spring Security filter chain, so "
                        + p.getPath() + " would serve the exposed entities to anyone who can reach it. Protect it "
                        + "with Spring Security (for example as an OAuth2 resource server), or set "
                        + "skailify.mcp.allow-unauthenticated=true for local development.");
            }
            log.warn("Skailify MCP: {} is served WITHOUT authentication (skailify.mcp.allow-unauthenticated=true); "
                    + "use this only for local development", p.getPath());
        };
    }

    private static McpJsonMapper mcpJsonMapper() {
        // Its own mapper: the app's customised one (naming strategies, views) must not change the MCP wire format.
        return new JacksonMcpJsonMapper(JsonMapper.builder().build());
    }
}
