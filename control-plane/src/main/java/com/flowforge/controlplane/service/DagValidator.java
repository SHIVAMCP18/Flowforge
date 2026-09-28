package com.flowforge.controlplane.service;

import com.flowforge.controlplane.dto.DagValidationResponse;
import com.flowforge.controlplane.dto.TaskSpec;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Validates a submitted task graph before it's ever persisted: every
 * dependsOn reference must point at a real task, task names must be unique,
 * and the graph must be acyclic. Runs a level-by-level Kahn's-algorithm
 * topological sort — if it can't consume every node, there's a cycle.
 * The levels double as the execution plan: tasks in the same level have no
 * dependencies on each other and can run in parallel.
 */
@Component
public class DagValidator {

    public DagValidationResponse validate(List<TaskSpec> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            throw new IllegalArgumentException("A workflow needs at least one task");
        }

        // Preserve submission order so the plan is deterministic.
        Map<String, Integer> position = new LinkedHashMap<>();
        for (TaskSpec t : tasks) {
            if (t.getName() == null || t.getName().isBlank()) {
                throw new IllegalArgumentException("Every task requires a non-blank name");
            }
            if (position.putIfAbsent(t.getName(), position.size()) != null) {
                throw new IllegalArgumentException("Duplicate task name: " + t.getName());
            }
            if (t.getCommand() == null || t.getCommand().isBlank()) {
                throw new IllegalArgumentException("Task '" + t.getName() + "' requires a command");
            }
            if (t.getTimeoutSeconds() != null && t.getTimeoutSeconds() <= 0) {
                throw new IllegalArgumentException("Task '" + t.getName() + "' timeoutSeconds must be positive");
            }
            if (t.getMaxRetries() != null && t.getMaxRetries() < 0) {
                throw new IllegalArgumentException("Task '" + t.getName() + "' maxRetries cannot be negative");
            }
        }

        Map<String, List<String>> dependents = new HashMap<>();   // upstream -> [downstream]
        Map<String, Integer> indegree = new HashMap<>();
        for (TaskSpec t : tasks) {
            indegree.putIfAbsent(t.getName(), 0);
            for (String dep : new LinkedHashSet<>(t.getDependsOn())) {
                if (dep.equals(t.getName())) {
                    throw new IllegalArgumentException("Task '" + t.getName() + "' cannot depend on itself");
                }
                if (!position.containsKey(dep)) {
                    throw new IllegalArgumentException(
                            "Task '" + t.getName() + "' depends on unknown task '" + dep + "'");
                }
                dependents.computeIfAbsent(dep, k -> new ArrayList<>()).add(t.getName());
                indegree.merge(t.getName(), 1, Integer::sum);
            }
        }

        Comparator<String> bySubmission = Comparator.comparingInt(position::get);
        List<String> current = new ArrayList<>();
        indegree.forEach((name, deg) -> { if (deg == 0) current.add(name); });
        current.sort(bySubmission);

        List<List<String>> levels = new ArrayList<>();
        List<String> order = new ArrayList<>();
        while (!current.isEmpty()) {
            levels.add(List.copyOf(current));
            order.addAll(current);
            List<String> next = new ArrayList<>();
            for (String name : current) {
                for (String downstream : dependents.getOrDefault(name, List.of())) {
                    if (indegree.merge(downstream, -1, Integer::sum) == 0) next.add(downstream);
                }
            }
            next.sort(bySubmission);
            current.clear();
            current.addAll(next);
        }

        if (order.size() != tasks.size()) {
            Set<String> done = new HashSet<>(order);
            List<String> stuck = position.keySet().stream().filter(n -> !done.contains(n)).toList();
            throw new IllegalArgumentException(
                    "Workflow definition contains a dependency cycle involving: " + String.join(", ", stuck));
        }

        return new DagValidationResponse(true, order, levels);
    }
}
