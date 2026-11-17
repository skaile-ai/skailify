// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * Behind a Skaile preview the proxy drops {@code Authorization} and forwards the bearer token in
 * {@code X-Skaile-Preview-Authorization}. This filter, ordered before the app's security filter
 * chain, presents that header as {@code Authorization} when the request has none, so the app's
 * own bearer authentication sees it. A request that has {@code Authorization} is left as it is.
 */
public final class PreviewAuthorizationFilter implements Filter {

    public static final String PREVIEW_HEADER = "X-Skaile-Preview-Authorization";
    static final String AUTHORIZATION = "Authorization";

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        if (request instanceof HttpServletRequest http
                && http.getHeader(AUTHORIZATION) == null
                && http.getHeader(PREVIEW_HEADER) != null) {
            chain.doFilter(new Wrapped(http, http.getHeader(PREVIEW_HEADER)), response);
            return;
        }
        chain.doFilter(request, response);
    }

    private static final class Wrapped extends HttpServletRequestWrapper {
        private final String authorization;

        Wrapped(HttpServletRequest request, String authorization) {
            super(request);
            this.authorization = authorization;
        }

        @Override
        public String getHeader(String name) {
            return AUTHORIZATION.equalsIgnoreCase(name) ? authorization : super.getHeader(name);
        }

        @Override
        public Enumeration<String> getHeaders(String name) {
            return AUTHORIZATION.equalsIgnoreCase(name)
                    ? Collections.enumeration(List.of(authorization))
                    : super.getHeaders(name);
        }

        @Override
        public Enumeration<String> getHeaderNames() {
            List<String> names = new ArrayList<>(Collections.list(super.getHeaderNames()));
            names.add(AUTHORIZATION);
            return Collections.enumeration(names);
        }
    }
}
