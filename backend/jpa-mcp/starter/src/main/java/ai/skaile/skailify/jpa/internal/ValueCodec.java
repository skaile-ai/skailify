// SPDX-License-Identifier: Apache-2.0
package ai.skaile.skailify.jpa.internal;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.OffsetDateTime;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Converts attribute values to JSON and JSON arguments to attribute values. Only the types
 * listed in {@link #kindOf(Class)} are served; an attribute of any other type is left out.
 */
public final class ValueCodec {

    /** How a served type appears in JSON, and which filters it takes. */
    public enum Kind {
        STRING("string", null, true, true),
        INTEGER("integer", null, true, false),
        NUMBER("number", null, true, false),
        BOOLEAN("boolean", null, false, false),
        ENUM("string", null, false, false),
        UUID("string", "uuid", false, false),
        DATE("string", "date", true, false),
        TIME("string", "time", true, false),
        DATE_TIME("string", "date-time", true, false);

        final String jsonType;
        final String format;
        final boolean ordered;
        final boolean text;

        Kind(String jsonType, String format, boolean ordered, boolean text) {
            this.jsonType = jsonType;
            this.format = format;
            this.ordered = ordered;
            this.text = text;
        }

        /** Whether {@code lt}, {@code lte}, {@code gt}, {@code gte} and sorting apply. */
        public boolean ordered() {
            return ordered;
        }

        /** Whether {@code contains} and {@code startsWith} apply. */
        public boolean text() {
            return text;
        }
    }

    private ValueCodec() {}

    /** The kind of a Java type, or {@code null} when it is not served. */
    public static Kind kindOf(Class<?> type) {
        Class<?> t = boxed(type);
        if (t == String.class || t == Character.class) return Kind.STRING;
        if (t == Long.class || t == Integer.class || t == Short.class || t == Byte.class || t == BigInteger.class) {
            return Kind.INTEGER;
        }
        if (t == Double.class || t == Float.class || t == BigDecimal.class) return Kind.NUMBER;
        if (t == Boolean.class) return Kind.BOOLEAN;
        if (t.isEnum()) return Kind.ENUM;
        if (t == UUID.class) return Kind.UUID;
        if (t == LocalDate.class) return Kind.DATE;
        if (t == LocalTime.class) return Kind.TIME;
        if (t == LocalDateTime.class || t == Instant.class || t == OffsetDateTime.class || t == ZonedDateTime.class) {
            return Kind.DATE_TIME;
        }
        return null;
    }

    /** The JSON schema of a value of this type. */
    public static Map<String, Object> schemaOf(Class<?> type) {
        Kind kind = kindOf(type);
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", kind.jsonType);
        if (kind.format != null) schema.put("format", kind.format);
        if (kind == Kind.ENUM) schema.put("enum", enumNames(boxed(type)));
        return schema;
    }

    /** The constant names of an enum type. */
    public static List<String> enumNames(Class<?> enumType) {
        List<String> names = new ArrayList<>();
        for (Object constant : enumType.getEnumConstants()) names.add(((Enum<?>) constant).name());
        return names;
    }

    /** An attribute value as JSON. */
    public static Object toJson(Object value) {
        if (value == null) return null;
        if (value instanceof Character c) return c.toString();
        if (value instanceof Enum<?> e) return e.name();
        if (value instanceof UUID
                || value instanceof LocalDate
                || value instanceof LocalTime
                || value instanceof LocalDateTime
                || value instanceof Instant
                || value instanceof OffsetDateTime
                || value instanceof ZonedDateTime) {
            return value.toString();
        }
        return value;
    }

    /**
     * A JSON argument as a value of the attribute's type.
     *
     * @throws ToolInputException when it is not one
     */
    public static Object fromJson(Object json, Class<?> type, String what) {
        if (json == null) {
            throw new ToolInputException(what + ": null is not a value here; use isNull to match missing values");
        }
        Class<?> t = boxed(type);
        try {
            if (t == String.class) return requireString(json, what);
            if (t == Character.class) {
                String s = requireString(json, what);
                if (s.length() != 1) throw new ToolInputException(what + ": expected a single character");
                return s.charAt(0);
            }
            if (t == Boolean.class) {
                if (json instanceof Boolean b) return b;
                throw new ToolInputException(what + ": expected true or false");
            }
            if (t == Long.class || t == Integer.class || t == Short.class || t == Byte.class || t == BigInteger.class) {
                BigInteger value = integral(json, what);
                if (t == BigInteger.class) return value;
                try {
                    long l = value.longValueExact();
                    if (t == Long.class) return l;
                    if (t == Integer.class) return Math.toIntExact(l);
                    if (t == Short.class && l >= Short.MIN_VALUE && l <= Short.MAX_VALUE) return (short) l;
                    if (t == Byte.class && l >= Byte.MIN_VALUE && l <= Byte.MAX_VALUE) return (byte) l;
                } catch (ArithmeticException e) {
                    // falls through to the range error
                }
                throw new ToolInputException(what + ": " + value + " is out of range");
            }
            if (t == Double.class || t == Float.class || t == BigDecimal.class) {
                BigDecimal value = decimal(json, what);
                if (t == BigDecimal.class) return value;
                if (t == Double.class) return value.doubleValue();
                return value.floatValue();
            }
            if (t.isEnum()) {
                String s = requireString(json, what);
                for (Object constant : t.getEnumConstants()) {
                    if (((Enum<?>) constant).name().equals(s)) return constant;
                }
                throw new ToolInputException(what + ": \"" + s + "\" is not one of " + enumNames(t));
            }
            if (t == UUID.class) return UUID.fromString(requireString(json, what));
            if (t == LocalDate.class) return LocalDate.parse(requireString(json, what));
            if (t == LocalTime.class) return LocalTime.parse(requireString(json, what));
            if (t == LocalDateTime.class) return LocalDateTime.parse(requireString(json, what));
            if (t == Instant.class) return Instant.parse(requireString(json, what));
            if (t == OffsetDateTime.class) return OffsetDateTime.parse(requireString(json, what));
            if (t == ZonedDateTime.class) return ZonedDateTime.parse(requireString(json, what));
        } catch (DateTimeParseException e) {
            throw new ToolInputException(what + ": expected an ISO-8601 " + kindOf(t).format + ", got \"" + json + "\"");
        } catch (IllegalArgumentException e) {
            throw new ToolInputException(what + ": " + e.getMessage());
        }
        throw new ToolInputException(what + ": values of type " + t.getSimpleName() + " cannot be given");
    }

    private static String requireString(Object json, String what) {
        if (json instanceof String s) return s;
        throw new ToolInputException(what + ": expected a string");
    }

    private static BigInteger integral(Object json, String what) {
        try {
            BigDecimal d = decimal(json, what);
            return d.toBigIntegerExact();
        } catch (ArithmeticException e) {
            throw new ToolInputException(what + ": expected a whole number, got " + json);
        }
    }

    private static BigDecimal decimal(Object json, String what) {
        if (json instanceof BigDecimal d) return d;
        if (json instanceof BigInteger i) return new BigDecimal(i);
        if (json instanceof Double || json instanceof Float) {
            double v = ((Number) json).doubleValue();
            if (Double.isNaN(v) || Double.isInfinite(v)) throw new ToolInputException(what + ": not a finite number");
            return BigDecimal.valueOf(v);
        }
        if (json instanceof Number n) return BigDecimal.valueOf(n.longValue());
        // Large ids may arrive as strings, so JSON clients that lose precision can still pass them.
        if (json instanceof String s) {
            try {
                return new BigDecimal(s.trim());
            } catch (NumberFormatException e) {
                throw new ToolInputException(what + ": expected a number, got \"" + s + "\"");
            }
        }
        throw new ToolInputException(what + ": expected a number");
    }

    private static Class<?> boxed(Class<?> type) {
        if (!type.isPrimitive()) return type;
        return switch (type.getName()) {
            case "int" -> Integer.class;
            case "long" -> Long.class;
            case "short" -> Short.class;
            case "byte" -> Byte.class;
            case "double" -> Double.class;
            case "float" -> Float.class;
            case "boolean" -> Boolean.class;
            case "char" -> Character.class;
            default -> type;
        };
    }

    /** {@code OrderLine} as {@code order_line}. */
    public static String snakeCase(String name) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (Character.isUpperCase(c)) {
                boolean boundary = i > 0
                        && (Character.isLowerCase(name.charAt(i - 1))
                                || Character.isDigit(name.charAt(i - 1))
                                || (i + 1 < name.length() && Character.isLowerCase(name.charAt(i + 1))));
                if (boundary && out.length() > 0 && out.charAt(out.length() - 1) != '_') out.append('_');
                out.append(Character.toLowerCase(c));
            } else if (Character.isLetterOrDigit(c)) {
                out.append(Character.toLowerCase(c));
            } else if (out.length() > 0 && out.charAt(out.length() - 1) != '_') {
                out.append('_');
            }
        }
        return out.toString().toLowerCase(Locale.ROOT);
    }
}
