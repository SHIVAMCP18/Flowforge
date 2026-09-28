package com.flowforge.controlplane.service;

import com.flowforge.controlplane.dto.TaskSpec;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DagValidatorTest {

    private final DagValidator validator = new DagValidator();

    private TaskSpec task(String name, String... deps) {
        TaskSpec t = new TaskSpec();
        t.setName(name);
        t.setCommand("echo " + name);
        t.setDependsOn(List.of(deps));
        return t;
    }

    @Test
    void acceptsValidLinearDag() {
        assertDoesNotThrow(() -> validator.validate(List.of(
                task("extract"),
                task("transform", "extract"),
                task("load", "transform")
        )));
    }

    @Test
    void acceptsDiamondDag() {
        assertDoesNotThrow(() -> validator.validate(List.of(
                task("a"),
                task("b", "a"),
                task("c", "a"),
                task("d", "b", "c")
        )));
    }

    @Test
    void rejectsCycle() {
        var ex = assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of(
                task("a", "b"),
                task("b", "a")
        )));
        assertTrue(ex.getMessage().contains("cycle"));
    }

    @Test
    void rejectsUnknownDependency() {
        var ex = assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of(
                task("a", "ghost")
        )));
        assertTrue(ex.getMessage().contains("unknown task"));
    }

    @Test
    void rejectsDuplicateNames() {
        assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of(
                task("a"), task("a")
        )));
    }
}
