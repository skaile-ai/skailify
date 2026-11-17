// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * A small shop on an in-memory H2 database. Its customers, products and orders are served
 * read-only over MCP at {@code http://127.0.0.1:8080/mcp}; its audit log is not served.
 */
@SpringBootApplication
public class ShopApplication {

    public static void main(String[] args) {
        SpringApplication.run(ShopApplication.class, args);
    }
}
