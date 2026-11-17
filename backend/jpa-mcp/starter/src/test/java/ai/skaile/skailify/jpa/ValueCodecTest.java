// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import ai.skaile.skailify.jpa.internal.ToolInputException;
import ai.skaile.skailify.jpa.internal.ValueCodec;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ValueCodecTest {

    enum Colour {
        RED,
        GREEN
    }

    @Test
    void convertsJsonArgumentsToAttributeTypes() {
        assertThat(ValueCodec.fromJson(7, Long.class, "x")).isEqualTo(7L);
        assertThat(ValueCodec.fromJson("9007199254740993", long.class, "x")).isEqualTo(9007199254740993L);
        assertThat(ValueCodec.fromJson(1.5, BigDecimal.class, "x")).isEqualTo(new BigDecimal("1.5"));
        assertThat(ValueCodec.fromJson("GREEN", Colour.class, "x")).isEqualTo(Colour.GREEN);
        assertThat(ValueCodec.fromJson("2024-02-29", LocalDate.class, "x")).isEqualTo(LocalDate.of(2024, 2, 29));
        UUID id = UUID.randomUUID();
        assertThat(ValueCodec.fromJson(id.toString(), UUID.class, "x")).isEqualTo(id);
    }

    @Test
    void rejectsValuesOfTheWrongShape() {
        assertThatThrownBy(() -> ValueCodec.fromJson(1.5, Integer.class, "n"))
                .isInstanceOf(ToolInputException.class).hasMessageContaining("whole number");
        assertThatThrownBy(() -> ValueCodec.fromJson(3_000_000_000L, Integer.class, "n"))
                .isInstanceOf(ToolInputException.class).hasMessageContaining("out of range");
        assertThatThrownBy(() -> ValueCodec.fromJson("blue", Colour.class, "c"))
                .isInstanceOf(ToolInputException.class).hasMessageContaining("[RED, GREEN]");
        assertThatThrownBy(() -> ValueCodec.fromJson("yesterday", Instant.class, "t"))
                .isInstanceOf(ToolInputException.class).hasMessageContaining("ISO-8601");
        assertThatThrownBy(() -> ValueCodec.fromJson(null, String.class, "s"))
                .isInstanceOf(ToolInputException.class).hasMessageContaining("isNull");
    }

    @Test
    void servesOnlyKnownTypes() {
        assertThat(ValueCodec.kindOf(byte[].class)).isNull();
        assertThat(ValueCodec.kindOf(Object.class)).isNull();
        assertThat(ValueCodec.kindOf(int.class)).isEqualTo(ValueCodec.Kind.INTEGER);
    }

    @Test
    void writesValuesAsJson() {
        assertThat(ValueCodec.toJson(Colour.RED)).isEqualTo("RED");
        assertThat(ValueCodec.toJson(LocalDate.of(2020, 1, 2))).isEqualTo("2020-01-02");
        assertThat(ValueCodec.toJson('c')).isEqualTo("c");
    }

    @Test
    void snakeCasesEntityNames() {
        assertThat(ValueCodec.snakeCase("OrderLine")).isEqualTo("order_line");
        assertThat(ValueCodec.snakeCase("URLAlias")).isEqualTo("url_alias");
        assertThat(ValueCodec.snakeCase("Book")).isEqualTo("book");
    }
}
