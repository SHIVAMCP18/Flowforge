package com.flowforge.controlplane.service;

import com.flowforge.controlplane.dto.*;
import com.flowforge.controlplane.exception.ConflictException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Exercises the scheduler's state machine against a real Postgres (leasing
 * relies on FOR UPDATE SKIP LOCKED, so an in-memory DB wouldn't prove much).
 * Runs only when FLOWFORGE_TEST_DB_URL points at a disposable database, e.g.
 *   FLOWFORGE_TEST_DB_URL=jdbc:postgresql://localhost:5432/flowforge_test mvn test
 */
@SpringBootTest(properties = "flowforge.scheduler.reaper-interval-ms=3600000")
@EnabledIfEnvironmentVariable(named = "FLOWFORGE_TEST_DB_URL", matches = ".+")
class SchedulerIntegrationTest {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> System.getenv("FLOWFORGE_TEST_DB_URL"));
        registry.add("spring.datasource.username", () -> env("FLOWFORGE_TEST_DB_USER", "flowforge"));
        registry.add("spring.datasource.password", () -> env("FLOWFORGE_TEST_DB_PASSWORD", "flowforge"));
        registry.add("flowforge.scheduler.retry-backoff-seconds", () -> "0");
    }

    private static String env(String key, String fallback) {
        String v = System.getenv(key);
        return v == null || v.isBlank() ? fallback : v;
    }

    @Autowired WorkflowService workflowService;
    @Autowired SchedulerService schedulerService;

    private TaskSpec task(String name, int maxRetries, String... deps) {
        TaskSpec t = new TaskSpec();
        t.setName(name);
        t.setCommand("echo " + name);
        t.setMaxRetries(maxRetries);
        t.setDependsOn(List.of(deps));
        return t;
    }

    private UUID registerDiamond(int maxRetries) {
        WorkflowDefinitionRequest req = new WorkflowDefinitionRequest();
        req.setName("it-diamond-" + UUID.randomUUID());
        req.setTasks(List.of(
                task("a", maxRetries),
                task("b", maxRetries, "a"),
                task("c", maxRetries, "a"),
                task("d", maxRetries, "b", "c")));
        return workflowService.registerDefinition(req).id();
    }

    /** Lease tasks until one belonging to this run comes back (other tests' runs may be queued too). */
    private TaskLeaseResponse leaseFor(UUID runId, String expectedTask) {
        List<TaskLeaseResponse> others = new ArrayList<>();
        try {
            for (int i = 0; i < 50; i++) {
                Optional<TaskLeaseResponse> lease = schedulerService.leaseTask("it-worker");
                assertTrue(lease.isPresent(), "expected READY work for " + expectedTask);
                if (lease.get().workflowRunId().equals(runId)) {
                    assertEquals(expectedTask, lease.get().taskName());
                    return lease.get();
                }
                others.add(lease.get());
            }
            fail("never leased " + expectedTask);
            return null;
        } finally {
            others.forEach(o -> schedulerService.completeTask(o.taskRunId(), null));
        }
    }

    private String status(UUID runId, String taskName) {
        return workflowService.getRun(runId).tasks().stream()
                .filter(t -> t.taskName().equals(taskName)).findFirst().orElseThrow().status();
    }

    @Test
    void runsDiamondToCompletionAndPassesCheckpointsDownstream() {
        UUID runId = workflowService.startRun(registerDiamond(1)).id();

        TaskLeaseResponse a = leaseFor(runId, "a");
        schedulerService.completeTask(a.taskRunId(), "rows=42");
        assertEquals("READY", status(runId, "b"));
        assertEquals("READY", status(runId, "c"));
        assertEquals("PENDING", status(runId, "d"));

        TaskLeaseResponse b = leaseFor(runId, "b");
        assertEquals(Map.of("a", "rows=42"), b.upstreamCheckpoints());
        schedulerService.completeTask(b.taskRunId(), "b-out");
        schedulerService.completeTask(leaseFor(runId, "c").taskRunId(), "c-out");

        TaskLeaseResponse d = leaseFor(runId, "d");
        assertEquals(Map.of("b", "b-out", "c", "c-out"), d.upstreamCheckpoints());
        schedulerService.completeTask(d.taskRunId(), "done");

        WorkflowRunView run = workflowService.getRun(runId);
        assertEquals("SUCCEEDED", run.status());
        assertNotNull(run.completedAt());
        assertEquals(List.of("b", "c"), run.tasks().stream()
                .filter(t -> t.taskName().equals("d")).findFirst().orElseThrow().dependsOn());
    }

    @Test
    void retriesThenFailsAndCascadesSkips() {
        UUID runId = workflowService.startRun(registerDiamond(2)).id();

        schedulerService.failTask(leaseFor(runId, "a").taskRunId(), "boom 1");
        assertEquals("READY", status(runId, "a"));
        schedulerService.failTask(leaseFor(runId, "a").taskRunId(), "boom 2");

        WorkflowRunView run = workflowService.getRun(runId);
        assertEquals("FAILED", run.status());
        assertEquals("FAILED", status(runId, "a"));
        assertEquals("SKIPPED", status(runId, "d"));
    }

    @Test
    void rejectsStaleCallbacksAfterTheTaskMovedOn() {
        UUID runId = workflowService.startRun(registerDiamond(3)).id();
        TaskLeaseResponse a = leaseFor(runId, "a");
        schedulerService.completeTask(a.taskRunId(), "ok");

        assertThrows(ConflictException.class, () -> schedulerService.completeTask(a.taskRunId(), "late"));
        assertThrows(ConflictException.class, () -> schedulerService.failTask(a.taskRunId(), "late"));
    }

    @Test
    void cancelStopsTheRunAndRetryResumesFromCheckpoints() {
        UUID runId = workflowService.startRun(registerDiamond(1)).id();
        schedulerService.completeTask(leaseFor(runId, "a").taskRunId(), "kept");
        TaskLeaseResponse b = leaseFor(runId, "b");

        WorkflowRunView cancelled = schedulerService.cancelRun(runId);
        assertEquals("CANCELLED", cancelled.status());
        assertEquals("CANCELLED", status(runId, "b"));
        assertThrows(ConflictException.class, () -> schedulerService.completeTask(b.taskRunId(), "late"));
        assertThrows(ConflictException.class, () -> schedulerService.cancelRun(runId));

        WorkflowRunView resumed = schedulerService.retryRun(runId);
        assertEquals("RUNNING", resumed.status());
        assertEquals("SUCCEEDED", status(runId, "a"));
        assertEquals("READY", status(runId, "b"));
        assertEquals("READY", status(runId, "c"));

        TaskLeaseResponse b2 = leaseFor(runId, "b");
        assertEquals(Map.of("a", "kept"), b2.upstreamCheckpoints());
        assertEquals(1, b2.attempt());
    }

    @Test
    void listsRunsWithTaskCountsAndFilters() {
        UUID defId = registerDiamond(1);
        UUID runId = workflowService.startRun(defId).id();

        List<WorkflowRunSummary> runs = workflowService.listRuns("running", defId, 10);
        assertEquals(1, runs.size());
        WorkflowRunSummary summary = runs.get(0);
        assertEquals(runId, summary.id());
        assertEquals(4, summary.totalTasks());
        assertEquals(1L, summary.taskCounts().get("READY"));
        assertEquals(3L, summary.taskCounts().get("PENDING"));
        assertTrue(summary.workflowName().startsWith("it-diamond-"));

        assertTrue(workflowService.listRuns("SUCCEEDED", defId, 10).isEmpty());
        assertThrows(IllegalArgumentException.class, () -> workflowService.listRuns("bogus", null, 10));
    }
}
