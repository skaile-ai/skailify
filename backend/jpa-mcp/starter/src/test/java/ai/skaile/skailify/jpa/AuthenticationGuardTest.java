// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.skaile.skailify.jpa.fixture.FixtureApp;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;

class AuthenticationGuardTest {

    @Test
    void refusesToServeWithoutSpringSecurityUnlessAllowed() {
        assertThatThrownBy(() -> new SpringApplicationBuilder(FixtureApp.class)
                        .properties("server.port=0", "spring.datasource.url=jdbc:h2:mem:guard")
                        .run()
                        .close())
                .hasStackTraceContaining("skailify.mcp.allow-unauthenticated");
    }
}
