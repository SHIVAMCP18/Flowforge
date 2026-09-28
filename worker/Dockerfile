# --- Build stage ---
FROM golang:1.22-alpine AS build
WORKDIR /build
COPY go.mod ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN CGO_ENABLED=0 go build -o /worker ./cmd/worker

# --- Runtime stage ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates
RUN adduser -D -u 1001 flowforge
COPY --from=build /worker /usr/local/bin/worker
USER flowforge
ENTRYPOINT ["/usr/local/bin/worker"]
