// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.security;

import static org.assertj.core.api.Assertions.assertThat;

import ai.skaile.skailify.jpa.fixture.FixtureApp;
import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

/**
 * The starter in an app with Spring Security: it starts without allow-unauthenticated, the app's
 * chain protects the endpoint, and the preview header reaches the chain as Authorization.
 */
@SpringBootTest(
        classes = {FixtureApp.class, SecuredEndpointTest.Security.class},
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "spring.datasource.url=jdbc:h2:mem:secured")
class SecuredEndpointTest {

    private static final String CREDENTIALS =
            "Basic " + Base64.getEncoder().encodeToString("agent:secret".getBytes(StandardCharsets.UTF_8));

    @Configuration
    @EnableWebSecurity
    static class Security {
        @Bean
        SecurityFilterChain chain(HttpSecurity http) throws Exception {
            return http.authorizeHttpRequests(a -> a.anyRequest().authenticated())
                    .httpBasic(b -> {})
                    .csrf(c -> c.disable())
                    .build();
        }

        @Bean
        UserDetailsService users() {
            return new InMemoryUserDetailsManager(
                    User.withUsername("agent").password("{noop}secret").roles("USER").build());
        }
    }

    @LocalServerPort
    int port;

    private HttpResponse<String> post(String header, String value) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/mcp"))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json, text/event-stream")
                .POST(HttpRequest.BodyPublishers.ofString("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}"));
        if (header != null) request.header(header, value);
        return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void refusesACallWithoutCredentials() throws Exception {
        assertThat(post(null, null).statusCode()).isEqualTo(401);
    }

    @Test
    void acceptsAuthorization() throws Exception {
        assertThat(post("Authorization", CREDENTIALS).statusCode()).isEqualTo(200);
    }

    @Test
    void acceptsThePreviewHeaderThroughTheAppsChain() {
        McpSyncClient client = McpClient.sync(HttpClientStreamableHttpTransport.builder("http://127.0.0.1:" + port)
                        .endpoint("/mcp")
                        .requestBuilder(HttpRequest.newBuilder().header("X-Skaile-Preview-Authorization", CREDENTIALS))
                        .build())
                .build();
        try {
            client.initialize();
            assertThat(client.listTools().tools()).isNotEmpty();
        } finally {
            client.closeGracefully();
        }
    }
}
