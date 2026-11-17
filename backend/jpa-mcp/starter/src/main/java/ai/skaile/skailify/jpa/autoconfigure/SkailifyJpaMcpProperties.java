// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.autoconfigure;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Configuration of the Skailify JPA/MCP starter, under {@code skailify.mcp}. */
@ConfigurationProperties(prefix = "skailify.mcp")
public class SkailifyJpaMcpProperties {

    /** Whether to serve the MCP endpoint at all. */
    private boolean enabled = true;

    /** The servlet path of the streamable HTTP MCP endpoint. */
    private String path = "/mcp";

    /** The server name reported to MCP clients. */
    private String serverName = "skailify-jpa-mcp";

    /** The server version reported to MCP clients. */
    private String serverVersion = "0.1.0";

    /** Instructions for the agent, sent when it connects. */
    private String instructions =
            "Read-only access to the app's data. Call describe_model first to see the record types and their filters.";

    /** Records per page when a call gives no limit. */
    private int defaultLimit = 50;

    /** The largest page a call may ask for. */
    private int maxLimit = 200;

    /** Query timeout in milliseconds; 0 leaves it to the JPA provider. */
    private int queryTimeoutMs = 10_000;

    /**
     * Serve the endpoint in an app without Spring Security. Off by default: an unprotected
     * endpoint hands the exposed data to anyone who can reach it. Turn it on only for local
     * development and tests.
     */
    private boolean allowUnauthenticated = false;

    /** Accept the bearer token in {@code X-Skaile-Preview-Authorization} when {@code Authorization} is absent. */
    private boolean previewAuthorization = true;

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getServerName() {
        return serverName;
    }

    public void setServerName(String serverName) {
        this.serverName = serverName;
    }

    public String getServerVersion() {
        return serverVersion;
    }

    public void setServerVersion(String serverVersion) {
        this.serverVersion = serverVersion;
    }

    public String getInstructions() {
        return instructions;
    }

    public void setInstructions(String instructions) {
        this.instructions = instructions;
    }

    public int getDefaultLimit() {
        return defaultLimit;
    }

    public void setDefaultLimit(int defaultLimit) {
        this.defaultLimit = defaultLimit;
    }

    public int getMaxLimit() {
        return maxLimit;
    }

    public void setMaxLimit(int maxLimit) {
        this.maxLimit = maxLimit;
    }

    public int getQueryTimeoutMs() {
        return queryTimeoutMs;
    }

    public void setQueryTimeoutMs(int queryTimeoutMs) {
        this.queryTimeoutMs = queryTimeoutMs;
    }

    public boolean isAllowUnauthenticated() {
        return allowUnauthenticated;
    }

    public void setAllowUnauthenticated(boolean allowUnauthenticated) {
        this.allowUnauthenticated = allowUnauthenticated;
    }

    public boolean isPreviewAuthorization() {
        return previewAuthorization;
    }

    public void setPreviewAuthorization(boolean previewAuthorization) {
        this.previewAuthorization = previewAuthorization;
    }
}
