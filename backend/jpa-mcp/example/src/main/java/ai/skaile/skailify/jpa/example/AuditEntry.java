// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.example;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import java.time.Instant;

/** Not annotated, so not served: an agent never sees the audit log. */
@Entity
public class AuditEntry {

    @Id
    private Long id;

    private Instant at;

    private String message;

    protected AuditEntry() {}
}
