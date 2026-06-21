#!/bin/bash

PROJECT_DIR="/volume1/Shared/Node/ManyScale"
NODE_FILE="server.js"
LOG_FILE="$PROJECT_DIR/server.log"
PID_FILE="$PROJECT_DIR/server.pid"

cd "$PROJECT_DIR"
echo "Server for MANYSCALE"

start_server() {
  if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "Server is already running (PID $(cat $PID_FILE))"
  else
    echo "Starting server..."
    nohup node "$NODE_FILE" > "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "Server started (PID $(cat $PID_FILE))"
  fi
}

stop_server() {
  if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
    echo "Stopping server (PID $(cat $PID_FILE))..."
    kill $(cat "$PID_FILE")
    rm -f "$PID_FILE"
    echo "Server stopped."
  else
    echo "Server is not running."
  fi
}

case "$1" in
  start) start_server ;;
  stop) stop_server ;;
  restart) stop_server; start_server ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 $(cat "$PID_FILE") 2>/dev/null; then
      echo "Server is running (PID $(cat $PID_FILE))"
    else
      echo "Server is not running."
    fi
    ;;
  *) echo "Usage: $0 {start|stop|restart|status}" ;;
esac
