# React Native codegen integration for the linux platform.
#
# Drives `scripts/codegen/run.js` which walks the JS package and (today)
# emits a stamp + a marker header under ${CMAKE_BINARY_DIR}/codegen/.
# Once a `linux` generator exists in `@react-native/codegen`, the same
# add_custom_command will start producing real Fabric Props/State/
# Component-Descriptor headers without any CMake-side changes.
#
# Configure-time inputs:
#   REACT_NATIVE_LINUX_RUN_CODEGEN  (BOOL, default ON when node found)
#   REACT_NATIVE_LINUX_JS_PACKAGE   (PATH, default …/packages/@lucid-softworks/react-native-linux)
#
# Output: target `react_native_linux_codegen`. The main library target
# depends on it so the stamp is always fresh before compilation.

find_program(NODE_EXECUTABLE NAMES node nodejs)

if(NODE_EXECUTABLE)
  set(_codegen_default ON)
else()
  set(_codegen_default OFF)
  message(STATUS "react-native-linux: node not found, skipping codegen step")
endif()

option(REACT_NATIVE_LINUX_RUN_CODEGEN
  "Run @react-native/codegen during the build"
  ${_codegen_default})

if(NOT DEFINED REACT_NATIVE_LINUX_JS_PACKAGE)
  set(REACT_NATIVE_LINUX_JS_PACKAGE
    "${CMAKE_CURRENT_LIST_DIR}/../../packages/@lucid-softworks/react-native-linux"
    CACHE PATH "Path to the JS package whose specs feed codegen")
endif()

set(RN_LINUX_CODEGEN_OUTPUT_DIR "${CMAKE_BINARY_DIR}/codegen")
set(RN_LINUX_CODEGEN_STAMP "${RN_LINUX_CODEGEN_OUTPUT_DIR}/.codegen-stamp.json")
set(RN_LINUX_CODEGEN_SCRIPT
  "${CMAKE_CURRENT_LIST_DIR}/../../scripts/codegen/run.js")

if(REACT_NATIVE_LINUX_RUN_CODEGEN AND EXISTS "${RN_LINUX_CODEGEN_SCRIPT}")
  # Discover the spec files so DEPENDS-on-globs works without re-running
  # configure when a new spec is added (Ninja stats the resolved list).
  file(GLOB_RECURSE RN_LINUX_CODEGEN_SPECS
    LIST_DIRECTORIES false
    "${REACT_NATIVE_LINUX_JS_PACKAGE}/Libraries/**/*NativeComponent.ts"
    "${REACT_NATIVE_LINUX_JS_PACKAGE}/Libraries/**/Native*.ts")

  add_custom_command(
    OUTPUT ${RN_LINUX_CODEGEN_STAMP}
    COMMAND ${NODE_EXECUTABLE} ${RN_LINUX_CODEGEN_SCRIPT}
            --package ${REACT_NATIVE_LINUX_JS_PACKAGE}
            --output ${RN_LINUX_CODEGEN_OUTPUT_DIR}
    DEPENDS ${RN_LINUX_CODEGEN_SCRIPT} ${RN_LINUX_CODEGEN_SPECS}
    COMMENT "Running react-native-linux codegen"
    VERBATIM)

  add_custom_target(react_native_linux_codegen ALL
    DEPENDS ${RN_LINUX_CODEGEN_STAMP})

  set(RN_LINUX_CODEGEN_AVAILABLE TRUE)
  message(STATUS "react-native-linux: codegen target enabled, specs=${REACT_NATIVE_LINUX_JS_PACKAGE}")
else()
  set(RN_LINUX_CODEGEN_AVAILABLE FALSE)
  message(STATUS "react-native-linux: codegen step skipped (RUN_CODEGEN=${REACT_NATIVE_LINUX_RUN_CODEGEN})")
endif()
