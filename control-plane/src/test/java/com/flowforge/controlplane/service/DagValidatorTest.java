package com.flowforge.controlplane.service;

import com.flowforge.controlplane.dto.DagValidationResponse;
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
        DagValidationResponse plan = validator.validate(List.of(
                task("extract"),
                task("transform", "extract"),
                task("load", "transform")
        ));
        assertEquals(List.of("extract", "transform", "load"), plan.order());
        assertEquals(3, plan.levels().size());
    }

    @Test
    void groupsParallelTasksIntoLevels() {
        DagValidationResponse plan = validator.validate(List.of(
                task("a"),
                task("b", "a"),
                task("c", "a"),
                task("d", "b", "c")
        ));
        assertEquals(List.of(List.of("a"), List.of("b", "c"), List.of("d")), plan.levels());
    }

    @Test
    void ordersTasksDeterministicallyRegardlessOfSubmissionOrder() {
        DagValidationResponse plan = validator.validate(List.of(
                task("load", "transform"),
                task("transform", "extract"),
                task("extract")
        ));
        assertEquals(List.of("extract", "transform", "load"), plan.order());
    }

    @Test
    void rejectsCycle() {
        var ex = assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of(
                task("a", "b"),
                task("b", "a"),
                task("c")
        )));
        assertTrue(ex.getMessage().contains("cycle"));
        assertTrue(ex.getMessage().contains("a, b"));
    }

    @Test
    void rejectsSelfDependency() {
        var ex = assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of(task("a", "a"))));
        assertTrue(ex.getMessage().contains("itself"));
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

    @Test
    void rejectsNonPositiveTimeoutAndNegativeRetries() {
        TaskSpec badTimeout = task("a");
        badTimeout.setTimeoutSeconds(0);
        assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of(badTimeout)));

        TaskSpec badRetries = task("b");
        badRetries.setMaxRetries(-1);
        assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of(badRetries)));
    }

    @Test
    void treatsNullDependsOnAsNoDependencies() {
        TaskSpec t = task("a");
        t.setDependsOn(null);
        assertEquals(List.of("a"), validator.validate(List.of(t)).order());
    }

    @Test
    void rejectsEmptyWorkflow() {
        assertThrows(IllegalArgumentException.class, () -> validator.validate(List.of()));
    }
}
