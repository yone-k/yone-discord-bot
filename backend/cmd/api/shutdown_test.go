package main

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestShutdownLetsAcceptedRequestFinish(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	entered := make(chan context.Context, 1)
	release := make(chan struct{})
	server := newHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		entered <- r.Context()
		<-release
		w.WriteHeader(http.StatusNoContent)
	}))
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	shutdownStarted := make(chan struct{})
	server.RegisterOnShutdown(func() { close(shutdownStarted) })
	finished := make(chan error, 1)
	go func() { finished <- serve(ctx, server, listener) }()
	response := make(chan int, 1)
	go func() {
		client := http.Client{Timeout: 3 * time.Second}
		r, e := client.Get("http://" + listener.Addr().String())
		if e != nil {
			response <- 0
			return
		}
		defer r.Body.Close()
		response <- r.StatusCode
	}()
	var requestContext context.Context
	select {
	case requestContext = <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case <-shutdownStarted:
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not start")
	}
	canceled := requestContext.Err()
	close(release)
	if status := <-response; status != 204 {
		t.Errorf("response status=%d", status)
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if canceled != nil {
		t.Fatalf("accepted request was canceled before graceful shutdown completed: %v", canceled)
	}
}
