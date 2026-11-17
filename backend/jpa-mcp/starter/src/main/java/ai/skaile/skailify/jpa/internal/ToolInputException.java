// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

/** A tool call whose arguments cannot be served; its message goes back to the agent. */
public class ToolInputException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public ToolInputException(String message) {
        super(message);
    }
}
