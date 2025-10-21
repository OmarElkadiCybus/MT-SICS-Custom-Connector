#!/usr/bin/env sh

# Make sure the script runs in the directory in which it is placed
DIR=$(dirname "$0")
cd "$DIR"

# Create a unique project name
PROJECT=ci-$(uuidgen | tr '[:upper:]' '[:lower:]')
export COMPOSE_PROJECT_NAME=${PROJECT}

# kill and remove any running containers
cleanup () {
  docker compose kill
  docker compose down
}
# catch unexpected failures, do cleanup and output an error message
trap 'cleanup ; printf "Tests Failed For Unexpected Reasons\n"'\
  HUP INT QUIT PIPE TERM

# run the composed services
docker compose build && docker compose up -d
if [ $? -ne 0 ] ; then
  printf "Docker Compose Failed\n"
  cleanup
  exit -1
fi

docker compose logs -f

EXIT_CODE=$(docker wait "${COMPOSE_PROJECT_NAME}-test-node-1")

cleanup

if [ "$EXIT_CODE" -ne 0 ] ; then
  printf "Tests Failed\n"
  exit 1
else
  printf "Tests Passed\n"
  exit 0
fi