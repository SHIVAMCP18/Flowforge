package com.flowforge.controlplane.service;

import com.flowforge.controlplane.dto.TaskSpec;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Validates a submitted task graph before it's ever persisted: every
 * dependsOn reference must point at a real task, task names must be unique,
 * and the graph must be acyclic. Runs a standard Kahn's-algorithm
 * topological sort — if it can't consume every node, there's a cycle.
 */
@Component
public class DagValidator {

    public void validate(List<TaskSpec> tasks) {
        Set<String> names = new HashSet<>();
        for (TaskSpec t : tasks) {
            if (t.getName() == null || t.getName().isBlank()) {
                throw new IllegalArgumentException("Every task requires a non-blank name");
            }
            if (!names.add(t.getName())) {
                throw new IllegalArgumentException("Duplicate task name: " + t.getName());
            }
            if (t.getCommand() == null || t.getCommand().isBlank()) {
                throw new IllegalArgumentException("Task '" + t.getName() + "' requires a command");
            }
        }

        Map<String, List<String>> dependents = new HashMap<>();   // upstream -> [downstream]
        Map<String, Integer> indegree = new HashMap<>();
        for (TaskSpec t : tasks) {
            indegree.putIfAbsent(t.getName(), 0);
            for (String dep : t.getDependsOn()) {
                if (!names.contains(dep)) {
                    throw new IllegalArgumentException(
                            "Task '" + t.getName() + "' depends on unknown task '" + dep + "'");
                }
                dependents.computeIfAbsent(dep, k -> new ArrayList<>()).add(t.getName());
                indegree.merge(t.getName(), 1, Integer::sum);
            }
        }

        Deque<String> queue = new ArrayDeque<>();
        indegree.forEach((name, deg) -> { if (deg == 0) queue.add(name); });

        int visited = 0;
        while (!queue.isEmpty()) {
            String current = queue.poll();
            visited++;
            for (String downstream : dependents.getOrDefault(current, List.of())) {
                int remaining = indegree.merge(downstream, -1, Integer::sum);
                if (remaining == 0) queue.add(downstream);
            }
        }

        if (visited != tasks.size()) {
            throw new IllegalArgumentException("Workflow definition contains a dependency cycle");
        }
    }
}
