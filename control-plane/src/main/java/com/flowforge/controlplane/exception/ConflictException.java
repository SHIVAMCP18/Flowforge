package com.flowforge.controlplane.exception;

/** The request is valid but conflicts with the current state (mapped to HTTP 409). */
public class ConflictException extends RuntimeException {
    public ConflictException(String message) {
        super(message);
    }
}
