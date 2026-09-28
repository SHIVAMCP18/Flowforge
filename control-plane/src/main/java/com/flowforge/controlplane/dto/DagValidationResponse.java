package com.flowforge.controlplane.dto;

import java.util.List;

/**
 * Result of a dry-run validation: a valid DAG plus its execution plan.
 * {@code levels} groups tasks that can run in parallel — every task in
 * level N depends only on tasks in levels before N.
 */
public record DagValidationResponse(
        boolean valid,
        List<String> order,
        List<List<String>> levels
) {}
