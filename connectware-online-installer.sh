#!/bin/bash

# Make sure the script runs in the directory in which it is placed
cd $(dirname `[[ $0 = /* ]] && echo "$0" || echo "$PWD/${0#./}"`)

shopt -s extglob # Allow !() http://mywiki.wooledge.org/glob

CONNECTWARE_VERSION="1.10.2"
CONNECTWARE_TAG="1.10.2"

# Configuration options
SILENT="false"
OFFLINE="false"
PREPARE_OFFLINE="false"
DOWNLOAD_LICENSE_FILE="false"
SYSTEMD="false"
LOGGING="false"
LOGFILENAME="connectware-install-log-${CONNECTWARE_VERSION}.txt"
LOGFILE="./${LOGFILENAME}"
CYBUS_REGISTRY_USER=""
CYBUS_REGISTRY_PASS=""
TARGET_DIR="/opt/connectware"
SYSTEMD_SERVICE_FILE="/etc/systemd/system/connectware.service"
OS_HAS_SYSTEMD="true"
FINAL_CLEARSCREEN="true"
DOCKER_ALREADY_LOGGEDIN="false"
CYBUS_REGISTRY_HOSTNAME="registry.cybus.io"
CYBUS_GRAPHQL_URL="https://graphql-server.cybus.io/graphql"
DOCKER_IMAGES_FILENAME="connectware-${CONNECTWARE_VERSION}.tar"

if [[ -z ${DOCKER_COMPOSE} ]]; then
  # Detect if compose is available as a plugin or not only if not passed through command line
  # If we found `docker compose` we set it as expected a few lines below
  docker compose version &> /dev/null
  result=$?
  if [ "$result" != "0" ]; then
      # If trying to find `docker compose` failed we switch to docker-compose
      DOCKER_COMPOSE="docker-compose"
  else
      DOCKER_COMPOSE="docker compose"
  fi
fi

# If DOCKER_COMPOSE is given as env variable, use that value; if not, use the
# default "docker-compose" instead.
: "${DOCKER_COMPOSE:=docker-compose}"
: "${CURL:=curl}"
: "${WGET:=wget}"

# Globals
EXITCODE=0
RE='\033[0;31m'
GR='\033[0;32m'
NC='\033[0m'
USE_CURL=""
USE_WGET=""

# The content of the docker-compose.yml file is inserted below
read -r -d '' DOCKER_COMPOSE_FILE_CONTENT <<'EOF'
networks:
  cybus:
    driver: bridge
    external: false
    ipam:
      config:
      - subnet: ${CYBUS_NETWORK_MASK}
      driver: default
services:
  admin-web-app:
    environment:
      CYBUS_ADMIN_WEB_APP_DISPLAY_VERSION: 1.10.2
      CYBUS_ADMIN_WEB_APP_VRPC_TIMEOUT: ${CYBUS_ADMIN_WEB_APP_VRPC_TIMEOUT}
    hostname: admin-web-app
    image: registry.cybus.io/cybus/admin-web-app:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
  auth-server:
    depends_on:
    - postgresql
    - system-control-server
    environment:
      CYBUS_ADMIN_USER_ENABLED: ${CYBUS_ADMIN_USER_ENABLED}
      CYBUS_AUTH_PASSWORD_POLICY_RULES: ${CYBUS_AUTH_PASSWORD_POLICY_RULES}
      CYBUS_INITIAL_ADMIN_USER_PASSWORD: ${CYBUS_INITIAL_ADMIN_USER_PASSWORD}
      CYBUS_LDAP_AUTO_ENFORCE_MFA: ${CYBUS_LDAP_AUTO_ENFORCE_MFA}
      CYBUS_LDAP_BIND_DN: ${CYBUS_LDAP_BIND_DN}
      CYBUS_LDAP_BIND_PASSWORD: ${CYBUS_LDAP_BIND_PASSWORD}
      CYBUS_LDAP_ENABLED: ${CYBUS_LDAP_ENABLED}
      CYBUS_LDAP_MEMBER_ATTRIBUTE: ${CYBUS_LDAP_MEMBER_ATTRIBUTE}
      CYBUS_LDAP_MODE: ${CYBUS_LDAP_MODE}
      CYBUS_LDAP_ROLES_ATTRIBUTE: ${CYBUS_LDAP_ROLES_ATTRIBUTE}
      CYBUS_LDAP_SEARCH_BASE: ${CYBUS_LDAP_SEARCH_BASE}
      CYBUS_LDAP_SEARCH_FILTER: ${CYBUS_LDAP_SEARCH_FILTER}
      CYBUS_LDAP_URL: ${CYBUS_LDAP_URL}
      CYBUS_LDAP_USER_RDN: ${CYBUS_LDAP_USER_RDN}
      CYBUS_LDAPS_CA_FILE: ${CYBUS_LDAPS_CA_FILE}
      CYBUS_LDAPS_TRUST_ALL_CERTS: ${CYBUS_LDAPS_TRUST_ALL_CERTS}
      CYBUS_MFA_BAN_DURATION_MINUTES: ${CYBUS_MFA_BAN_DURATION_MINUTES}
      CYBUS_MFA_ENABLED: ${CYBUS_MFA_ENABLED}
      CYBUS_MFA_ENCRYPTION_SALT: ${CYBUS_MFA_ENCRYPTION_SALT}
      CYBUS_MFA_ENCRYPTION_SECRET: ${CYBUS_MFA_ENCRYPTION_SECRET}
      CYBUS_MFA_MAX_INVALID_OTPS_PER_USER: ${CYBUS_MFA_MAX_INVALID_OTPS_PER_USER}
      CYBUS_MFA_WINDOW: ${CYBUS_MFA_WINDOW}
      CYBUS_MS_ENTRA_ID_CALLBACK_DOMAIN: ${CYBUS_MS_ENTRA_ID_CALLBACK_DOMAIN}
      CYBUS_MS_ENTRA_ID_CLIENT_ID: ${CYBUS_MS_ENTRA_ID_CLIENT_ID}
      CYBUS_MS_ENTRA_ID_CLIENT_SECRET: ${CYBUS_MS_ENTRA_ID_CLIENT_SECRET}
      CYBUS_MS_ENTRA_ID_ENABLED: ${CYBUS_MS_ENTRA_ID_ENABLED}
      CYBUS_MS_ENTRA_ID_ISSUER_URL: ${CYBUS_MS_ENTRA_ID_ISSUER_URL}
      CYBUS_MS_ENTRA_ID_TENANT_ID: ${CYBUS_MS_ENTRA_ID_TENANT_ID}
      CYBUS_MS_ENTRA_ID_USERNAME_MAPPING_FIELD: ${CYBUS_MS_ENTRA_ID_USERNAME_MAPPING_FIELD}
      NODE_ENV: production
    hostname: auth-server
    image: registry.cybus.io/cybus/auth-server:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
  broker:
    depends_on:
    - auth-server
    - system-control-server
    environment:
      AUTH_SERVER_IP: auth-server
      CYBUS_BROKER_USE_MUTUAL_TLS: ${CYBUS_BROKER_USE_MUTUAL_TLS}
      LISTENER_CA_FILE: /connectware_certs/cybus_ca.crt
      LISTENER_CERT_FILE: /connectware_certs/cybus_server.crt
      LISTENER_KEY_FILE: /connectware_certs/cybus_server.key
      MAX_OFFLINE_MESSAGES: 100
      MAX_ONLINE_MESSAGES: 3000
      PERSISTENT_CLIENT_EXPIRATION: 1d
      WEBHOOKS_CA_FILE: /connectware_certs/shared_yearly_server.crt
      WEBHOOKS_CERT_FILE: /connectware_certs/shared_yearly_server.crt
      WEBHOOKS_KEY_FILE: /connectware_certs/shared_yearly_server.key
    hostname: broker
    image: registry.cybus.io/cybus/broker:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
    - brokerData:/vernemq/data
    - brokerLog:/vernemq/log
  connectware:
    depends_on:
    - system-control-server
    hostname: connectware
    image: registry.cybus.io/cybus/ingress:1.10.2
    labels:
    - io.cybus.connectware=core
    - io.cybus.role=ingress
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    ports:
    - 1883:1883
    - 8883:8883
    - 443:8443
    - 80:8081
    - 4841:4841
    - 40000-40100:40000-40100
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
  container-manager:
    depends_on:
    - auth-server
    - broker
    - system-control-server
    environment:
      CYBUS_CM_RPC_TIMEOUT: ${CYBUS_CM_RPC_TIMEOUT}
      CYBUS_REGISTRY_PASS: ${CYBUS_REGISTRY_PASS}
      CYBUS_REGISTRY_USER: ${CYBUS_REGISTRY_USER}
      CYBUS_SENSITIVE_ENVIRONMENT_VARIABLES: ${CYBUS_SENSITIVE_ENVIRONMENT_VARIABLES}
      NODE_ENV: production
    hostname: container-manager
    image: registry.cybus.io/cybus/container-manager:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
    user: root
    volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - certs:/connectware_certs
  ingress-controller:
    depends_on:
    - system-control-server
    environment:
      CYBUS_ROUTE_TIMEOUT: 30
      MAX_TCP_CONNECTIONS: 10000
    hostname: ingress-controller
    image: registry.cybus.io/cybus/ingress-controller:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
  postgresql:
    depends_on:
    - system-control-server
    environment:
      NODE_ENV: production
      POSTGRES_DB: cybus_connectware
      POSTGRES_USER: cybus-admin
    hostname: postgresql
    image: registry.cybus.io/cybus/postgresql:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: always
    volumes:
    - postgresql:/var/lib/postgresql/data
    - certs:/connectware_certs
  protocol-mapper:
    depends_on:
    - broker
    - system-control-server
    environment:
      CYBUS_MQTT_USERNAME: __sys-protocol-mapper
      CYBUS_PM_RPC_TIMEOUT: ${CYBUS_PM_RPC_TIMEOUT}
      NODE_ENV: production
    hostname: protocol-mapper
    image: registry.cybus.io/cybus/protocol-mapper:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    privileged: true
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
  service-manager:
    depends_on:
    - auth-server
    - broker
    - container-manager
    - system-control-server
    environment:
      CYBUS_MQTT_HOST_FROM_SERVICES: connectware
      CYBUS_SM_RPC_TIMEOUT: ${CYBUS_SM_RPC_TIMEOUT}
      CYBUS_STORAGE_DIR: /data
      CYBUS_USE_SERVICES_GRAPH: "true"
      NODE_ENV: production
    hostname: service-manager
    image: registry.cybus.io/cybus/service-manager:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
    - service-manager:/data
  system-control-server:
    environment:
      CYBUS_REGISTRY_PASS: ${CYBUS_REGISTRY_PASS}
      CYBUS_SCS_RPC_TIMEOUT: ${CYBUS_SCS_RPC_TIMEOUT}
      GLOBAL_AGENT_HTTP_PROXY: ${CYBUS_PROXY}
      GLOBAL_AGENT_HTTPS_PROXY: ${CYBUS_PROXY}
      GLOBAL_AGENT_NO_PROXY: ${CYBUS_NO_PROXY}
      NODE_ENV: production
    hostname: system-control-server
    image: registry.cybus.io/cybus/system-control-server:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
    - systemControlServerData:/data
  workbench:
    depends_on:
    - auth-server
    - broker
    environment:
      CYBUS_WORKBENCH_PROJECTS_ENABLED: ${CYBUS_WORKBENCH_PROJECTS_ENABLED}
      HTTP_PROXY: ${CYBUS_PROXY}
      HTTPS_PROXY: ${CYBUS_PROXY}
      NO_PROXY: ${CYBUS_NO_PROXY}
      SUPPRESS_NO_CONFIG_WARNING: 1
    hostname: workbench
    image: registry.cybus.io/cybus/workbench:1.10.2
    labels:
    - io.cybus.connectware=core
    logging:
      driver: json-file
      options:
        max-file: "2"
        max-size: 10m
    networks:
    - cybus
    restart: unless-stopped
    volumes:
    - certs:/connectware_certs
    - workbench:/data/.node-red
version: "2.0"
volumes:
  brokerData: null
  brokerLog: null
  certs: null
  postgresql: null
  service-manager: null
  systemControlServerData: null
  workbench: null
EOF

# ###################################################################

# parse arguments
function parseArgs () {
  for arg in "$@"
  do
    case $arg in
        -s|--silent)
        SILENT="true"
        shift
        ;;
        -o|--offline)
        OFFLINE="true"
        shift
        ;;
        -P|--prepare-offline)
        PREPARE_OFFLINE="true"
        shift
        ;;
        -D|--download-license-file)
        DOWNLOAD_LICENSE_FILE="true"
        shift
        ;;
        -S|--service)
        SYSTEMD="true"
        shift
        ;;
        -l|--logging)
        LOGGING="true"
        shift
        ;;
        -f|--logfile)
        LOGFILE="$2/${LOGFILENAME}"
        shift
        ;;
        -d|--directory)
        TARGET_DIR="$2"
        shift
        ;;
        -k|--license-key)
        if ${SILENT} || ${DOWNLOAD_LICENSE_FILE} ; then
          CYBUS_REGISTRY_PASS="$2"
        fi
        shift
        ;;
        -h|--help)
        printHelp
        shift
        ;;
        *)
        shift
        ;;
    esac
  done
}

function printHelp () {
  echo "$(basename "$0") [-OPTIONS] -- program to install Connectware version ${CONNECTWARE_VERSION}

  OPTIONS:
      -S  | --service                      Install systemd service (requires root privileges; default: no)
      -d  | --directory <DIRECTORY>        Set target installation directory (default: ${TARGET_DIR})
      -l  | --logging                      Create logfile during installation (default: no)
      -f  | --logfile  <DIRECTORY>         Set output directory path of logfile.
                                           Default path with filename: ${LOGFILE}
      -k  | --license-key <license-key>    Set license key (only used in silent mode)
      -s  | --silent                       Install in silent mode (no interactive output)
      -o  | --offline                      Install in offline mode (no Internet access used)

    Alternative modes of operation, instead of installing:
      -h  | --help                         Show this help text
      -P  | --prepare-offline              Preparation of files needed for offline install mode
      -D  | --download-license-file        Just download license file (needs -k or -d option set)
      "
  exit 0
}

# ###################################################################

# Helper
function clearScreen () {
  printf "\033c"
}

function action () {
  if ! $SILENT; then
    local action=$1
    echo "Press [ENTER] to ${action}"
    read
  fi
}

function getRunningContainers () {
  # All previous connectware containers have that label.
  docker ps -aq --filter="label=io.cybus.connectware=core"
  # ... with the one exception: the bootstrap container. We can nevertheless
  # recognize it because it was create as docker-compose service name
  # "bootstrap", it has mounted the given named volume, and it is exited
  # already.
  docker ps -aq --filter="label=com.docker.compose.service=bootstrap" \
    --filter="volume=/connectware_certs" --filter="status=exited"
}

function getRunningLegacyContainers () {
  legacyContainers=(
    auth-server
    bootstrap
    broker
    connectware
    container-manager
    device-dispatcher
    device-mapper
    fluentd-mongo
    ingress-controller
    log-aggregator
    log-server
    mongo
    service-manager-server
    system-control-server
    workbench
  )

  for hostname in  ${legacyContainers[@]}; do
    containers=$(docker ps -aq)
    if [ ! -z "${containers}" ]; then
      docker inspect -f "{{ if eq \"${hostname}\" .Config.Hostname }}{{.Id}}{{ end }}" ${containers}
    fi
  done
}

# Look up all old images from cybus and remove them, except if they have the tag
# given as argument
function pruneImagesExceptTag() {
  local IMAGE_TAG_EXCLUDE=$1
  local IMAGE_NAMES=(
    auth-server
    broker
    connectware
    container-manager
    device-mapper
    ingress
    ingress-controller
    postgresql
    protocol-mapper
    service-manager
    system-control-server
    workbench
  )
  local REGISTRY_PREFIX="${CYBUS_REGISTRY_HOSTNAME}/cybus"

  if [ -z "${IMAGE_TAG_EXCLUDE}" ]; then
    echo "Error: IMAGE_TAG_EXCLUDE argument empty"
    exit 1
  fi

  ANYTHING_TO_REMOVE="false"

  for IMAGE_NAME in ${IMAGE_NAMES[@]}; do
    # Look up all images that match our repository+name combination
    IMG_IDS=$(docker images --format "{{.ID}}:{{.Tag}}" "${REGISTRY_PREFIX}/${IMAGE_NAME}" |
      grep -v ${IMAGE_TAG_EXCLUDE} |
      cut -d: -f1)
    if [ -n "${IMG_IDS}" ]; then
      # Yes, there are some old images
      if ! ${ANYTHING_TO_REMOVE}; then
        # Print headline once we encouter the first images
        echo ""
        echo "-----------------------------------------"
        echo "Removing old Docker images"
        echo "-----------------------------------------"
        echo ""
        echo "The following Docker images are from previous Connectware versions (other "
        echo "than ${CONNECTWARE_VERSION}) and can be removed:"
        echo ""
        ANYTHING_TO_REMOVE=true
      fi
      # Collect the IDs of the to-be-removed images
      OBSOLETE_IMG_IDS="${OBSOLETE_IMG_IDS} ${IMG_IDS}"

      # Print those images also in user-readable form
      docker images "${REGISTRY_PREFIX}/${IMAGE_NAME}" | grep -v ${IMAGE_TAG_EXCLUDE}
    fi
  done

  # Did we find any to-be-removed imaged?
  if ${ANYTHING_TO_REMOVE}; then
    # Yes, then ask again, then call docker-image-rm
    echo ""
    echo "-----------------------------------------"
    echo ""
    if dialog "Should the above docker images be removed from your local computer (pruned)? [Y/n]"; then
      if $SILENT; then
        docker image rm ${OBSOLETE_IMG_IDS} 2> /dev/null
      else
        docker image rm ${OBSOLETE_IMG_IDS}
      fi
    else
      echo ""
      echo "Docker images unchanged."
    fi
  #else
  #  echo "Checked for Docker images from previous Connectware versions - none found."
  fi

}

function login () {
  if ${OFFLINE}; then
    printf "${GR}Skipping license validation in offline mode.${NC}\n\n"
    return 0
  fi

  # Check whether we were already logged in beforehand
  if grep -qF "${CYBUS_REGISTRY_HOSTNAME}" "${HOME}/.docker/config.json" 2>/dev/null ; then
    DOCKER_ALREADY_LOGGEDIN="true"
  fi

  local name=$1
  local pass=$2
  echo "Verifying license key..."
  docker login -u $name -p $pass ${CYBUS_REGISTRY_HOSTNAME} > /dev/null 2>&1
  if [[ $? -eq "Succeeded" ]]; then
    printf "${GR}Verification succeeded.${NC}\n"
    return 0
  else
    printf "${RE}Verification failed.${NC} Please reenter license key.\n"
    return 1
  fi
}

function logout () {
  # Do not call docker logout if we already had a login before
  if ${DOCKER_ALREADY_LOGGEDIN}; then return 0; fi

  docker logout ${CYBUS_REGISTRY_HOSTNAME} > /dev/null 2>&1
  if [[ $? -eq "Succeeded" ]]; then
    # printf "${GR}Logout succeeded.${NC}\n"
    return 0
  else
    printf "${RE}Docker logout failed.${NC} Please run docker logout manually from your console\n"
    return 1
  fi
}

function dialog () {
  local text=$1
  local default=$2

  if $SILENT; then
    return 0
  fi

  while true; do
  printf "${text} "
  read -r -p "" input
    case $input in
      [yY][eE][sS]|[yY])
        return 0;;
      [nN][oO]|[nN])
        return 1;;
      *)
        if [[ "${default}" == "n" ]]; then
          return 1
        else
          return 0
        fi
        ;;
    esac
  done
}

function warnMsg () {
  local str="$*"

  >&2 echo ""
  >&2 echo "Warning:"
  >&2 echo "=================================="
  >&2 echo -e "$str"
  >&2 echo "=================================="
  >&2 echo ""
}

function warn() {
  warnMsg "$*"
  action "continue!"
  FINAL_CLEARSCREEN=false
}

function error () {
  local str="$*"

  >&2 echo ""
  echo -e "\e[91m"
  >&2 echo "Something went wrong!"
  >&2 echo "=================================="
  echo -e "\e[0m"
  >&2 echo -e "$str"
  echo -e "\e[91m"
  >&2 echo "Exited with error code: $EXITCODE"
  >&2 echo "=================================="
  >&2 echo ""
  echo -e "\e[0m"
  if ! ${OFFLINE}; then
    logout >/dev/null
  fi
  action "quit!"
  exit $EXITCODE
}

function success () {
  if ${FINAL_CLEARSCREEN} ; then
    clearScreen
  fi
  echo "Successfully installed Connectware!"
  echo "==================================="
  echo "You can find the installation directory at ${TARGET_DIR}."
  if $SYSTEMD; then
    echo "In order to stop type:"
    printf "${GR}systemctl stop connectware${NC}\n"
  else
    echo "In order to start type:"
    printf "${GR}cd ${TARGET_DIR}${NC}\n"
    printf "${GR}${DOCKER_COMPOSE} up -d${NC}\n"
  fi
  echo ""
  exit 0
}

function preflightWritePermission () {
  printf "Validating write permission to installation location ${TARGET_DIR}: "
  # Does the path exist?
  if [ -e "${TARGET_DIR}" ]; then
    # Is it not writable?
    if [ ! -w "${TARGET_DIR}" ]; then
      printf "[${RE}FAILED${NC}]\n"
      EXITCODE=1
      if [ `ls -ld "${TARGET_DIR}" | awk '{print $3}'` = "root" ] ; then
        error "No write permission to existing installation directory: ${TARGET_DIR}\n" \
          " Please restart the installation script as root or using sudo."
      else
        error "No write permission to existing installation directory: ${TARGET_DIR}"
      fi
    fi
    # Is it not a directory?
    if [ ! -d "${TARGET_DIR}" ]; then
      printf "[${RE}FAILED${NC}]\n"
      EXITCODE=1
      error "Specified installation path exists and is not a directory: ${TARGET_DIR}"
    fi
  else
    # Path does not exist. However, the TARGET_DIR might include several levels
    # of directories (mkdir -p), so we only error out here if the first parent
    # exists and is not writable
    PARENTDIR=`dirname "${TARGET_DIR}"`
    # Does the path exist?
    if [ -e "${PARENTDIR}" ]; then
      # Is it not a directory?
      if [ ! -d "${PARENTDIR}" ]; then
        printf "[${RE}FAILED${NC}]\n"
        EXITCODE=1
        error "Specified location for installation directory exists, but is not a directory: ${TARGET_DIR}"
      fi
      # Is it not writable?
      if [ ! -w "${PARENTDIR}" ]; then
        printf "[${RE}FAILED${NC}]\n"
        EXITCODE=1
        if [ `ls -ld "${PARENTDIR}" | awk '{print $3}'` = "root" ] ; then
          error "No write permission in ${PARENTDIR} to create installation directory: ${TARGET_DIR}\n" \
            " Please restart the installation script as root or using sudo."
        else
          error "No write permission in ${PARENTDIR} to create installation directory: ${TARGET_DIR}"
        fi
      fi
    fi
  fi
  printf "[${GR}OK${NC}]\n"
}

function preflightSystemdExists () {
  printf "Checking whether this system has systemd: "
  if [ -d $(dirname ${SYSTEMD_SERVICE_FILE}) ]; then
    OS_HAS_SYSTEMD=true
    printf "[${GR}YES${NC}]\n"
  else
    OS_HAS_SYSTEMD=false
    printf "[${GR}NO${NC}]\n"
    if $SYSTEMD ; then
      EXITCODE=1
      error "The command line option for installing as system-service was specified ('-S'), but this system does not have systemd."
    fi
  fi
}

function preflightWritePermissionSystemService () {
  # Does the systemd file exist?
  if [ -e "${SYSTEMD_SERVICE_FILE}" ]; then
    if ! ${SYSTEMD}; then
      echo -e "Note: Existing Connectware installation as systemd service found. Therefore," \
        "\n      the current installation will also be installed as systemd service," \
        "\n      even though this has not been specified right now."
      SYSTEMD=true
    fi
  fi

  if ${SYSTEMD}; then
    printf "Validating write permission for system service: "
    # Does the systemd file exist?
    if [ -e "${SYSTEMD_SERVICE_FILE}" ]; then
      if [ ! -w "${SYSTEMD_SERVICE_FILE}" ]; then
        printf "[${RE}FAILED${NC}]\n"
        EXITCODE=1
        error "No write permission to system-service file: ${SYSTEMD_SERVICE_FILE}\n" \
          "It seems you do not have sufficient access permissions to install the system-service.\n" \
          "Please restart the installation script as root or using sudo."
      fi
    else
      # Do we not have write permission to the service file's parent dir?
      if [ ! -w `dirname ${SYSTEMD_SERVICE_FILE}` ]; then
        printf "[${RE}FAILED${NC}]\n"
        EXITCODE=1
        error "No write permission to install as Connectware system-service.\n" \
          "(No write permission for file ${SYSTEMD_SERVICE_FILE}).\n" \
          "It seems you do not have sufficient access permissions to install the system-service.\n" \
          "Please restart the installation script as root or using sudo."
      fi
    fi
    printf "[${GR}OK${NC}]\n"

    # Also check TARGET_DIR to be an absolute path because we write this in the
    # systemd file
    if [[ ! "${TARGET_DIR}" = /* ]]; then
      EXITCODE=1
      error "The installation location must be an absolute path, but is: ${TARGET_DIR}"
    fi
  fi
}

function preflightOffline() {
  printf "Offline installation: "
  if [ ! -f docker-compose.yml ]; then
    echo "${DOCKER_COMPOSE_FILE_CONTENT}" > ./docker-compose.yml
  fi

  IMAGES_LIST=$( grep 'image: ' docker-compose.yml  | cut -d: -f2-3 )
  docker image inspect ${IMAGES_LIST} >/dev/null
  EXITCODE=$?
  if [[ $EXITCODE -ne 0 ]]; then
    # Do we have a local file with the docker images? Then load it
    if [ -f ${DOCKER_IMAGES_FILENAME} ] ; then
      printf "Loading all Docker container images from ${DOCKER_IMAGES_FILENAME} ... "
      docker load -i ${DOCKER_IMAGES_FILENAME}
      printf "${GR}done${NC}\n"
    fi
  fi

  docker image inspect ${IMAGES_LIST} >/dev/null
  EXITCODE=$?
  if [[ $EXITCODE -ne 0 ]]; then
    warnMsg "The docker images for the Connectware are not yet installed, \n" \
      "but must be installed beforehand in offline installation mode."

    if dialog "Should the instructions for installing the docker images be printed? [Y/n]"; then
      FILENAME="connectware-${CONNECTWARE_VERSION}.tar"
      echo
      echo "1. On a computer with Internet access, run this install script in online mode"
      echo "   so that the docker images are pulled (downloaded) correctly."
      echo "2. Export the docker images into an archive with the following command:"
      echo "   (watch out: this must be one long command line)"
      echo
      echo "   docker save -o ${FILENAME}" ${IMAGES_LIST}
      echo
      echo "   (If this failes with the error \"Error response from daemon: "
      echo "   reference does not exist\", it means in step 1 the online installation"
      echo "   did not pull the images correctly and they are not yet downloaded.)"
      echo
      echo "3. Copy the file ${FILENAME} to this computer"
      echo "4. Import the docker images into this computer with the following command:"
      echo
      echo "  docker load -i ${FILENAME}"
      echo
      echo "Then run this script again in offline mode."
    fi

    error "Docker images are missing, but must be installed beforehand in offline mode."
  fi

  printf "[${GR}OK${NC}]\n"
}

function preflightUtils () {
  printf "Validating required utility installation: "
  if [ -x "$(command -v ${CURL})" ]; then
    USE_CURL="true"
    USE_WGET="false"
  elif [ -x "$(command -v ${WGET})" ]; then
    USE_CURL="false"
    USE_WGET="true"
  else
    EXITCODE=1
    error "Please install curl or wget (or set env variables pointing to any of these, CURL=${CURL}, WGET=${WGET}) and restart the installation process.\n"
  fi
  printf "[${GR}OK${NC}]\n"
}

function checkUrl () {
  local URL=$1
  local ALLOW_400_REPLY=$2
  if ${USE_CURL} ; then
    ${CURL} ${URL} -s -f -o /dev/null
  else ${USE_WGET}
    ${WGET} -4 -q -O /dev/null ${URL}
  fi
  EXITCODE=$?
  # Non-zero exit code is an error, except if we had a second argument set, in
  # which case there is an error except exit code 22 ("curl" response on valid
  # graphql url with 400 response) or 8 ("wget" response on valid graphql url
  # with 400 response)
  if [[ $EXITCODE -ne 0 && \
    ( -z "${ALLOW_400_REPLY}" || ( ${EXITCODE} -ne 22 && ${EXITCODE} -ne 8 ) ) ]]; then
    warnMsg "Cannot reach this URL: ${URL}"
  else
    EXITCODE=0
  fi
}

function preflightUrlAccess () {
  local RESULT=0
  printf "Validating reachable URL for Cybus docker-registry: "
  checkUrl "https://${CYBUS_REGISTRY_HOSTNAME}"
  if [[ $EXITCODE -eq 0 ]] ; then
    printf "[${GR}OK${NC}]\n"
  else
    RESULT=${EXITCODE}
    printf "[${RE}NOT REACHABLE${NC}]\n"
  fi

  printf "Validating reachable URL for Cybus docker-registry authentication: "
  checkUrl "https://docker-auth.cybus.io"
  if [[ $EXITCODE -eq 0 ]] ; then
    printf "[${GR}OK${NC}]\n"
  else
    RESULT=${EXITCODE}
    printf "[${RE}NOT REACHABLE${NC}]\n"
  fi

  printf "Validating reachable URL for Cybus portal backend: "
  checkUrl "${CYBUS_GRAPHQL_URL}" "1"
  if [[ $EXITCODE -eq 0 ]] ; then
    printf "[${GR}OK${NC}]\n"
  else
    RESULT=${EXITCODE}
    printf "[${RE}NOT REACHABLE${NC}]\n"
  fi

  if [[ ${RESULT} -ne 0 ]] ; then
    echo ""
    echo "Some URLs could not be reached, but are needed for online installation. "
    echo "Please check your internet connectivity, proxy, and firewall settings."
    if dialog "Do you want to continue anyway? [y/N]" "n"; then
      echo "Ignoring missing online connectivity."
      echo ""
    else
      error "Some URLs could not be reached, but are needed for online installation. Please check your internet connectivity, proxy, and firewall settings."
    fi
  fi
}

function preflightDocker () {
  printf "Validating Docker installation: "
  if [ ! -x "$(command -v docker)" ]; then
    EXITCODE=$?
    error "Please install Docker and restart the installation process.\n"
  fi
  # Check if Docker is installed as a snap package.
  # This can cause problems with different Docker configs for Docker and Docker Compose
  if [ $(command -v docker | grep snap) ]; then
    EXITCODE=1
    error "Docker is installed using a snap package, which can cause problems when using docker compose.\nPlease remove the snap package, install docker without snap, and restart the installation process."
  fi
  printf "[${GR}OK${NC}]\n"
}

function preflightDockerCompose () {
  printf "Validating Docker Compose installation: "

  if [[ "${DOCKER_COMPOSE}" == "docker compose" ]] ; then
    printf "Using docker compose plugin [${GR}OK${NC}]\n"
    return 0
  fi
  # Is the variable not yet pointing to an executable (as absolute path)? Then
  # look up the actual executable
  if [ ! -x "${DOCKER_COMPOSE}" ] ; then
    DOCKER_COMPOSE=`which ${DOCKER_COMPOSE}`
  fi
  # Still no absolute path? Error out.
  if [ ! -x "${DOCKER_COMPOSE}" ] ; then
    EXITCODE=1
    error "The command docker-compose (or the compose plugin for docker) is needed and expected in the PATH (or as \n" \
      "DOCKER_COMPOSE environment variable). Please install Docker Compose (or add \n" \
      "it to the PATH, or set the env variable DOCKER_COMPOSE) and restart the \n" \
      "installation process."
  fi
  printf "[${GR}OK${NC}]\n"
}

function preflightStopConnectware () {
  printf "Validating that no former Connectware is running: "
  if [[ "$(getRunningContainers)" != "" ]]; then
    printf "[${RE}running Connectware containers found${NC}]\n"
    printf "Stopping and removing running containers: "
    docker rm $(docker stop $(getRunningContainers)) > /dev/null 2>&1
    EXITCODE=$?

    if [[ $EXITCODE -ne 0 ]]; then
      printf "[${RE}FAILED${NC}]\n"
      error "Please stop these containers by hand and restart the installation process:\n" \
        "$(getRunningContainers)"
    else
      printf "[${GR}OK${NC}]\n"
    fi
  elif [[ "$(getRunningLegacyContainers)" != "" ]]; then
    printf "[${RE}running Connectware containers found${NC}]\n"
    printf "Stopping and removing running containers: "
    docker rm $(docker stop $(getRunningLegacyContainers)) > /dev/null 2>&1
    EXITCODE=$?

    if [[ $EXITCODE -ne 0 ]]; then
      printf "[${RE}FAILED${NC}]\n"
      error "Please stop these containers by hand and restart the installation process:\n" \
        "$(getRunningLegacyContainers)"
    else
      printf "[${GR}OK${NC}]\n"
    fi
  else
    printf "[${GR}OK${NC}]\n"
  fi
}

function preflightMigrateEnv () {
  if [[ -e "${TARGET_DIR}/.env" ]]; then
    echo "Migrating existing envs from installation directory ${TARGET_DIR}"
    source "${TARGET_DIR}/.env"
  fi
}

function configureRegistryCreds () {
  local loggedin=false
  if ! $SILENT; then
    echo ""
    echo "Please enter the key you received with your Connectware license."
    echo "----------------------------------------------------------------"

    if [ ! -z "$CYBUS_REGISTRY_USER" ] && [ "$CYBUS_REGISTRY_USER" != "license" ]; then
      warn "User authentication has changed from username / password to license keys." \
          "Please provide a valid license key to continue the installation." \
          "If you do not possess a license key please contact us at support@cybus.io"
      CYBUS_REGISTRY_PASS=""
      CYBUS_REGISTRY_USER=""
    fi

    if [ ! -z "$CYBUS_REGISTRY_PASS" ] && [ ! -z "$CYBUS_REGISTRY_USER" ]; then
      echo "Existing license key found."
      login $CYBUS_REGISTRY_USER $CYBUS_REGISTRY_PASS
      EXITCODE=$?
      if [[ $EXITCODE -ne 0 ]]; then
       echo "-------------------------------------------------------"
      else
        loggedin=true
      fi
    fi

    until $loggedin; do
      echo ""
      printf "license key: "
      read -sp "" CYBUS_REGISTRY_PASS
      loggedin="login license $CYBUS_REGISTRY_PASS"
      echo ""
    done
  else
    if [ -z "$CYBUS_REGISTRY_PASS" ]; then
      EXITCODE=1
      error "You have to pass the license key in silent mode!"
    fi

    login "license" $CYBUS_REGISTRY_PASS

    if [[ ! $? ]]; then
      EXITCODE=1
      error "Supplied license key is invalid."
    fi
  fi
}


function configurePath () {
  local accepted=false
  echo ""
  echo "Please choose the installation directory."
  echo "-----------------------------------------"
    echo ""
    printf "Installation path [${TARGET_DIR}]: "
    echo ""
    read -p "" path
    TARGET_DIR=${path:-$TARGET_DIR}
    if [[ $TARGET_DIR != /* ]]; then
      if [[ $TARGET_DIR == ./* ]]; then
        TARGET_DIR=${TARGET_DIR:2}
      fi
      TARGET_DIR=$(pwd)/${TARGET_DIR}
    fi
  echo ""
}

function configureSystemd () {
  local accepted=false
  echo "Please choose the startup behavior"
  echo "-------------------------------------------"
  echo ""
  if dialog "Start automatically on boot via system-service? [y/N]" "n"; then
    SYSTEMD=true
    preflightWritePermissionSystemService
  else
    SYSTEMD=false
  fi
  echo ""
}

function acceptConfig () {
  clearScreen
  echo "Please review and confirm the following Connectware configuration:"
  echo "------------------------------------------------------------------"
  echo ""
  echo "Connectware license key:       [VALID]"
  echo "Installation directory:       ${TARGET_DIR}"
  if ${OS_HAS_SYSTEMD}; then
    echo "Autostart as systemd service: ${SYSTEMD}"
  fi
  echo ""
  if ! dialog "Accept configuration? [Y/n]"; then
    configureEverything
  fi
}

function installConnectware () {
  echo "Installing Connectware."

  # Remove legacy files
  if [ -e ${TARGET_DIR} ]; then
    rm -f ${TARGET_DIR}/start.sh 2>&1
    EXITCODE=$?
    rm -f ${TARGET_DIR}/stop.sh 2>&1
    EXITCODE+=$?
    rm -f ${TARGET_DIR}/docker-compose.prod.yml 2>&1
    EXITCODE+=$?

    if [[ $EXITCODE -ne 0 ]]; then
      warn "Encountered problems deleting legacy files.\n" \
        "Please remove these files manually after the installation has finished:\n" \
        "$([ ! -e ${TARGET_DIR}/start.sh ] || echo "${TARGET_DIR}/start.sh\n")" \
        "$([ ! -e ${TARGET_DIR}/stop.sh ] || echo "${TARGET_DIR}/stop.sh\n")" \
        "$([ ! -e ${TARGET_DIR}/docker-compose.prod.yml ] || echo "${TARGET_DIR}/docker-compose.prod.yml")"
    fi
  fi

  mkdir -p ${TARGET_DIR}
  EXITCODE=$?
  if [ ${EXITCODE} -ne 0 ]; then
    error "Could not create output directory ${TARGET_DIR}"
  fi
  if [ ! -w ${TARGET_DIR} ]; then
    EXITCODE=1
    error "No write permission in output directory ${TARGET_DIR}"
  fi

  if ${OFFLINE}; then
    # If docker-compose doesn't exist already, copy it to TARGET_DIR (and this
    # check beforehand should catch the situation when source and target file
    # are the same file)
    if [ ! -f "${TARGET_DIR}/docker-compose.yml" ] ||
      ! cmp -s docker-compose.yml "${TARGET_DIR}/docker-compose.yml" ; then
      # Copy the file
      cp -f docker-compose.yml ${TARGET_DIR}
    fi
    EXITCODE=$?
    if [ ${EXITCODE} -ne 0 ]; then
      error "Could not copy docker-compose.yaml to output directory ${TARGET_DIR}"
    fi
  fi

  cd ${TARGET_DIR}

  echo "${DOCKER_COMPOSE_FILE_CONTENT}" > ./docker-compose.yml

  # Check again that we really have the file now
  if [ ! -f docker-compose.yml ]; then
    error "Missing docker-compose.yml file - could not create it? Check directory permissions."
  fi

  # Overwrite .env file (note: cwd=TARGET_DIR here)
cat << EOF > .env
# Network configuration
# Used to manually set masks for the internal
# Connectware network.
CYBUS_NETWORK_MASK=${CYBUS_NETWORK_MASK:-172.30.0.0/24}

# Secrets
# Here you can enter your Cybus Connectware username and password
CYBUS_REGISTRY_USER=license
CYBUS_REGISTRY_PASS=${CYBUS_REGISTRY_PASS}

# Security settings: Should the default 'admin' user be enabled?
CYBUS_ADMIN_USER_ENABLED=${CYBUS_ADMIN_USER_ENABLED:-true}
# The initial password of 'admin' user, as base64-encoded value. It must comply with any password policy rules if there are some.
CYBUS_INITIAL_ADMIN_USER_PASSWORD=${CYBUS_INITIAL_ADMIN_USER_PASSWORD:-YWRtaW4=}
# Password policy
CYBUS_AUTH_PASSWORD_POLICY_RULES=${CYBUS_AUTH_PASSWORD_POLICY_RULES:-}

# LDAP Configuration
CYBUS_LDAP_ENABLED=${CYBUS_LDAP_ENABLED:-false}
CYBUS_LDAP_URL=${CYBUS_LDAP_URL}
CYBUS_LDAP_MODE=${CYBUS_LDAP_MODE}
CYBUS_LDAP_BIND_DN=${CYBUS_LDAP_BIND_DN}
CYBUS_LDAP_BIND_PASSWORD=${CYBUS_LDAP_BIND_PASSWORD}
CYBUS_LDAP_SEARCH_BASE=${CYBUS_LDAP_SEARCH_BASE}
CYBUS_LDAP_ROLES_ATTRIBUTE=${CYBUS_LDAP_ROLES_ATTRIBUTE}
CYBUS_LDAP_MEMBER_ATTRIBUTE=${CYBUS_LDAP_MEMBER_ATTRIBUTE}
CYBUS_LDAP_USER_RDN=${CYBUS_LDAP_USER_RDN}

# Workbench Configuration
CYBUS_WORKBENCH_PROJECTS_ENABLED=${CYBUS_WORKBENCH_PROJECTS_ENABLED:-false}

# Broker mutual TLS Configuration
CYBUS_BROKER_USE_MUTUAL_TLS=${CYBUS_BROKER_USE_MUTUAL_TLS:-'no'}

# Proxy Configuration
CYBUS_PROXY=${CYBUS_PROXY:-}
CYBUS_NO_PROXY=${CYBUS_NO_PROXY:-}

# Multi Factor Authentication Secrets. Values MUST be base64 encoded.
CYBUS_MFA_ENCRYPTION_SECRET=${CYBUS_MFA_ENCRYPTION_SECRET}
CYBUS_MFA_ENCRYPTION_SALT=${CYBUS_MFA_ENCRYPTION_SALT}
# Multi Factor Authentication endpoints are protected against multiple invalid OTP entries that when reached temporary ban the user.
# These configs allow customizing how many failures are allowed and how long the ban lasts.
# Default max invalid OTPs is set to 5 and default ban duration is 5 minutes
CYBUS_MFA_MAX_INVALID_OTPS_PER_USER=${CYBUS_MFA_MAX_INVALID_OTPS_PER_USER:-5}
CYBUS_MFA_BAN_DURATION_MINUTES=${CYBUS_MFA_BAN_DURATION_MINUTES:-5}
CYBUS_MFA_ENABLED=${CYBUS_MFA_ENABLED:false}
CYBUS_MS_ENTRA_ID_ENABLED=${CYBUS_MS_ENTRA_ID_ENABLED:false}
CYBUS_MS_ENTRA_ID_CLIENT_ID=${CYBUS_MS_ENTRA_ID_CLIENT_ID:''}
CYBUS_MS_ENTRA_ID_TENANT_ID=${CYBUS_MS_ENTRA_ID_TENANT_ID:''}
CYBUS_MS_ENTRA_ID_CALLBACK_DOMAIN=${CYBUS_MS_ENTRA_ID_CALLBACK_DOMAIN}
CYBUS_MS_ENTRA_ID_CLIENT_SECRET=${CYBUS_MS_ENTRA_ID_CLIENT_SECRET:''}
CYBUS_MS_ENTRA_ID_ISSUER_URL=${CYBUS_MS_ENTRA_ID_ISSUER_URL:''}
CYBUS_MS_ENTRA_ID_USERNAME_MAPPING_FIELD=${CYBUS_MS_ENTRA_ID_USERNAME_MAPPING_FIELD:'upn'}
CYBUS_ADMIN_WEB_APP_VRPC_TIMEOUT=${CYBUS_ADMIN_WEB_APP_VRPC_TIMEOUT}
CYBUS_PM_RPC_TIMEOUT=${CYBUS_PM_RPC_TIMEOUT}
CYBUS_SM_RPC_TIMEOUT=${CYBUS_SM_RPC_TIMEOUT}
CYBUS_SCS_RPC_TIMEOUT=${CYBUS_SCS_RPC_TIMEOUT}
CYBUS_CM_RPC_TIMEOUT=${CYBUS_CM_RPC_TIMEOUT}
EOF
  EXITCODE=$?
  if [ ${EXITCODE} -ne 0 ]; then
    error "Error on writing env file (missing write permissions?)"
  fi

  # We are already pulling here, using the fact that we are currently logged in
  if ! ${OFFLINE}; then
    ${DOCKER_COMPOSE} pull 2>&1
    EXITCODE=$?
  fi
  cd - > /dev/null 2>&1

  if [[ $EXITCODE -ne 0 ]]; then
    warn "Unable to pull Connectware containers. (Maybe invalid license?)\n" \
      "Please run the following commands after the installation is finished:\n" \
      "-----------------------------------\n" \
      "cd ${TARGET_DIR}\n" \
      "${DOCKER_COMPOSE} pull"
  else

    # Pull was successful, hence prune old images which are not needed anymore.
    # Prune older images unrelated to this TAG
    pruneImagesExceptTag ${CONNECTWARE_TAG}
  fi
}

function installService () {
  if [ -e "${SYSTEMD_SERVICE_FILE}" ]; then
    if [ ! -w "${SYSTEMD_SERVICE_FILE}" ]; then
      EXITCODE=1
      error "No write permission to system-service file: ${SYSTEMD_SERVICE_FILE}"
    fi
    echo "Existing Connectware-System-Service found."
    echo "Starting migration to version ${CONNECTWARE_VERSION}"
    echo "------------------------------------------"

    systemctl disable connectware
    EXITCODE=$?

    if [[ $EXITCODE -ne 0 ]]; then
      error "Failed to disable Connectware system-service.\n" \
        "Please disable the Connectware system-service manually by running the following command\n" \
        "-----------------------------------\n" \
        "sudo systemctl disable connectware\n" \
        "-----------------------------------\n" \
        "and restart the installation process."
    fi

    SYSTEMD=true
  fi

  if $SYSTEMD; then
    echo "Generating Connectware-System-Service."
    echo "--------------------------------------"

cat << EOF > ${SYSTEMD_SERVICE_FILE}
[Install]
WantedBy=multi-user.target

[Unit]
Description=Cybus Connectware Service
Requires=docker.service
After=docker.service

[Service]
EnvironmentFile=${TARGET_DIR}/.env
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${TARGET_DIR}
ExecStart=${DOCKER_COMPOSE} up -d
ExecStop=${DOCKER_COMPOSE} down
TimeoutStartSec=0
EOF
    EXITCODE=$?

    if [[ $EXITCODE -ne 0 ]]; then
      error "Failed to generate Connectware system-service." \
        "It seems you do not have sufficient access permissions to install the system-service.\n" \
        "Please restart the installation script as root or using sudo."
    fi

    echo "----------------------------------"
    echo "Enabling system-service."
    systemctl enable connectware
    EXITCODE=$?

    if [[ $EXITCODE -ne 0 ]]; then
      warn "Failed to enable Connectware system-service.\n" \
            "Please enable the system-service manually by running the following command\n" \
            "--------------------------------------------\n" \
            "sudo systemctl enable connectware\n" \
            "--------------------------------------------\n" \
            "after the installation has finished."
    fi
    printf "${GR}System-service successfully enabled.${NC}\n"

    echo "----------------------------------"
    echo "Starting system-service."
    systemctl restart connectware
    EXITCODE=$?

    if [[ $EXITCODE -ne 0 ]]; then
      warn "Failed to start Connectware system-service.\n" \
            "Please start the system-service manually by running the following command\n" \
            "--------------------------------------------\n" \
            "sudo systemctl restart connectware\n" \
            "--------------------------------------------\n" \
            "after the installation has finished."
    fi
    printf "${GR}System-service successfully started.${NC}\n"

  fi
}

function printLicensenameFromFile () {
  local filename=$1
  NAME=$(grep -Eo '"licenseName":"([^"]*)"' ${filename} | cut -d\" -f4 | tr ' /*"' '____' )
  echo "${NAME}"
}

function printLicenseFileContent () {
  local filename=$1
  LICENSEFILE=$(grep -Eo '"connectwareLicenseFile":"([^"]*)"' ${filename} | cut -d\" -f4 )
  echo "${LICENSEFILE}"
}

function downloadLicenseFile () {
  # Retrieve license file using the given key and save it into the output file
  local licenseKey=$1
  local outputFile=$2
  local tmpFile=`mktemp`

  printf "Downloading license file ... "

  QUERY="{ \"query\": \"{ connectwareLicenseFile(connectwareLicenseKey: \\\"${licenseKey}\\\") {  licenseName connectwareLicenseFile } }\" }"
  URL="${CYBUS_GRAPHQL_URL}"
  HDR="Content-Type: application/json"

  if ${USE_CURL} ; then
    ${CURL} -s -X POST -o "${tmpFile}" -H "${HDR}" --data "${QUERY}" "${URL}"
  else
    ${WGET} -4 -q -O "${tmpFile}" --header="${HDR}" --post-data="${QUERY}" "${URL}"
  fi

  if grep -q '^{"errors"' ${tmpFile} ; then
    MSG=$(grep -Eo '"message":"([^"]*)"' ${tmpFile} | cut -d\" -f4 )
    printf "${RE}failed: ${MSG} ${NC}\n"
    rm -f ${tmpFile}
  else
    NAME=$(printLicensenameFromFile ${tmpFile} )
    CONTENT=$(printLicenseFileContent ${tmpFile} )
    if [ -z ${outputFile} ] ; then
      DATE=$(date --iso-8601)
      outputFile="connectware-licensefile-${NAME}-${DATE}.lic"
    fi

    echo "${CONTENT}" > ${outputFile}
    rm -f ${tmpFile}
    printf "${GR}done: Saved into ${outputFile}${NC}\n"
  fi
}

function createOfflineFiles () {
  # Get list of all images that the Connectware needs
  IMAGES_LIST=$( grep 'image: ' docker-compose.yml  | cut -d: -f2-3 )
  docker image inspect ${IMAGES_LIST} >/dev/null
  EXITCODE=$?
  if [[ $EXITCODE -ne 0 ]]; then
    error "Not all Docker images for the Connectware are available locally, \n" \
      "but must be pulled successfully for offline preparation mode."
  fi

  printf "Saving all Docker container images in ${DOCKER_IMAGES_FILENAME} ... "
  docker save -o "${DOCKER_IMAGES_FILENAME}" ${IMAGES_LIST}
  printf "${GR}done${NC}\n"

  DATE=$(date --iso-8601)
  LICENSE_FILE="connectware-licensefile-${DATE}.lic"
  downloadLicenseFile ${CYBUS_REGISTRY_PASS} ${LICENSE_FILE}

  echo ""
  echo "Successfully prepared all files for offline installation."
  echo ""
  echo "Next steps:"
  echo ""
  echo "1. Copy the following files to the target computer:"
  echo "     ${0}"
  echo "     ${DOCKER_IMAGES_FILENAME}"
  echo "2. Run the installer script with --offline argument on the target computer."
  echo "3. Start the Connectware on the target computer"
  echo "4. Access the Admin UI of the Connectware with your browser. When asked to "
  echo "   upload a license file, upload the file "
  echo "     ${LICENSE_FILE} "
  echo "   that was just prepared here."
  printf "${GR}Finished!${NC}\n"
  echo ""
}

# ###################################################################

# Start screen
function startScreen () {
  clearScreen
  echo -e "     88                                                                    "
  echo -e "   88°               .oooooo.             oo88                             "
  echo -e " o88°  oo           d8P°   Y8               88                             "
  echo -e "p88    °88.        888         ooooo  oooo  88.o88o.  ooo   ooo    .oooo.o "
  echo -e " °88.    °88.      888          °88.  .8°   d88° °88  °88   °88   d88(  ^8 "
  echo -e "   °8.    o88p     888           °88..8°    888   88   88    88   °^Y88b.  "
  echo -e "     °^  .88°      °88b    oo     °888°     888   88   88    88   o.  )88b "
  echo -e "        o88         °Y8bood8P      .8°      88°PodP°   °V88V^V8P° 8^^888P° "
  echo -e "       PP                        ..P°                                      "
  echo -e "                                Y8P°                                       "
  echo    ""
  echo    "     Welcome to the Cybus Connectware installer for version ${CONNECTWARE_VERSION}."
  echo    "     =============================================================="
  echo    ""

  if ! dialog "Do you wish to install? [Y/n]"; then
    echo "Installation exited by user."
    exit 0
  fi
}

# Preflight checks
function preflightChecks () {
  clearScreen
  # check internal configuration
  if [ -z "${DOCKER_COMPOSE_FILE_CONTENT}" ] ; then
    error "Internal error: No docker-compose content delivered with this installer.sh"
  fi
  if ${OFFLINE} && ${PREPARE_OFFLINE} ; then
    error "Both --offline and --prepare-offline arguments given, but the latter requires being online"
  fi

  if ${PREPARE_OFFLINE} ; then
    OS_HAS_SYSTEMD="false"
    TARGET_DIR=${PWD}

    echo "Preparing offline installation of Connectware ${CONNECTWARE_VERSION}"
    echo ""
    echo "Running preflight checks."
    echo "========================="
    preflightUtils
    preflightUrlAccess
    preflightDocker
    preflightMigrateEnv
  else
    # Must ask for the installation path now, in order to check its accessibility
    if ! ${SILENT} ; then
      configurePath
    fi

    echo "Running preflight checks."
    echo "========================="

    preflightWritePermission
    preflightSystemdExists
    preflightWritePermissionSystemService
    if ${OFFLINE}; then
      preflightOffline
    else
      # online installation
      preflightUtils
      preflightUrlAccess
    fi
    preflightDocker
    preflightDockerCompose
    preflightStopConnectware
    preflightMigrateEnv
  fi
  echo "Preflight checks finished successfully!"
  echo ""
}

# configuration
function configureEverything () {
  echo "Configuring Connectware installation."
  echo "====================================="
  configureRegistryCreds
  if ! ${SILENT} && ! ${PREPARE_OFFLINE} ; then
    if ${OS_HAS_SYSTEMD} ; then
      configureSystemd
    fi
    acceptConfig
  fi
}

# Special mode of operation: Prepare the files for offline installation
function prepareOfflineFiles () {
  clearScreen
  installConnectware
  createOfflineFiles
}

# Install Connectware
function installEverything () {
  clearScreen
  installConnectware
  installService
  if ! ${OFFLINE}; then
    logout
    action "continue."
  fi
  success
}

# ###################################################################

# The actual action
function main () {
  # Special mode: Just downloading license file
  if ${DOWNLOAD_LICENSE_FILE} ; then
    preflightUtils
    preflightMigrateEnv
    if [ -z ${CYBUS_REGISTRY_PASS} ] ; then
      error "For --download-license-file, you must either specify the target installation " \
        "directory (-d), or directly the license key (-k)."
    fi
    downloadLicenseFile ${CYBUS_REGISTRY_PASS}
    return
  fi

  if ! ${PREPARE_OFFLINE} ; then
    # Welcome
    startScreen
  fi

  # Check for all prerequisites
  preflightChecks

  # Ask for the configuration
  configureEverything

  if ${PREPARE_OFFLINE} ; then
    # Special mode of operation: Prepare the files for offline installation
    prepareOfflineFiles
  else

    # And do the installation
    installEverything
  fi
}

# ###################################################################

# Initialize installation, set up logging output, and continue in main()
function init () {
  # modes
  local interactive="main"
  local interactivelogging="main 2>&1 1>/dev/null 1>/dev/tty | tee -a ${LOGFILE}"
  local silent="main 2>&1 1>/dev/null"
  local silentLogging="main 2>&1 1>/dev/null | tee -a ${LOGFILE}"

  parseArgs "$@"

  if $LOGGING; then
    local startDate=$(date '+%d/%m/%Y %H:%M:%S');
    echo "Starting Connectware v. ${CONNECTWARE_VERSION} installation" >>${LOGFILE}
    if [ ! -f ${LOGFILE} ]; then
      EXITCODE=1
      error "Specified log file is not a regular file: ${LOGFILE}"
    fi
    if [ ! -w ${LOGFILE} ]; then
      EXITCODE=1
      error "No write permission to specified log file: ${LOGFILE}"
    fi
    echo "======================================="
    echo "# This step might take a few minutes. #"
    echo "#  Please do not close this window!   #"
    echo "======================================="
    echo "$startDate" >>${LOGFILE}
    echo "" >>${LOGFILE}
  fi

  if $SILENT && $LOGGING; then
    eval $silentLogging
    exit $EXITCODE
  fi

  if $SILENT; then
    eval $silent
    exit $EXITCODE
  fi

  if $LOGGING; then
    eval $interactivelogging
    exit $EXITCODE
  fi

  eval $interactive
  exit $EXITCODE


}

init "$@"
