// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import static org.assertj.core.api.Assertions.assertThat;

import ai.skaile.skailify.jpa.internal.PreviewAuthorizationFilter;
import jakarta.servlet.http.HttpServletRequest;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class PreviewAuthorizationFilterTest {

    private static String authorizationSeenDownstream(MockHttpServletRequest request) throws Exception {
        AtomicReference<String> seen = new AtomicReference<>();
        new PreviewAuthorizationFilter().doFilter(request, new MockHttpServletResponse(),
                (req, res) -> seen.set(((HttpServletRequest) req).getHeader("authorization")));
        return seen.get();
    }

    @Test
    void usesThePreviewHeaderWhenAuthorizationIsAbsent() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/mcp");
        request.addHeader("X-Skaile-Preview-Authorization", "Bearer preview");
        assertThat(authorizationSeenDownstream(request)).isEqualTo("Bearer preview");
    }

    @Test
    void authorizationWinsWhenBothArePresent() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/mcp");
        request.addHeader("Authorization", "Bearer direct");
        request.addHeader("X-Skaile-Preview-Authorization", "Bearer preview");
        assertThat(authorizationSeenDownstream(request)).isEqualTo("Bearer direct");
    }

    @Test
    void leavesARequestWithNeitherAlone() throws Exception {
        assertThat(authorizationSeenDownstream(new MockHttpServletRequest("POST", "/mcp"))).isNull();
    }
}
