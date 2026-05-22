# ReactNativeHeaders.cmake — locate the react-native npm package and expose
# its native source trees (ReactCommon, jsi, codegen output) for inclusion.

# If REACT_NATIVE_ROOT is unset or points at a directory that no longer
# exists (the pnpm hoist layout shifts depending on which workspace
# initiated the install), walk a fixed candidate list. This keeps the
# CLI flag a "preferred" hint rather than a hard requirement.
if(NOT DEFINED REACT_NATIVE_ROOT OR NOT EXISTS "${REACT_NATIVE_ROOT}/package.json")
  set(_candidates
    "${CMAKE_CURRENT_SOURCE_DIR}/../node_modules/react-native"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/react-native"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../node_modules/react-native"
    "${CMAKE_SOURCE_DIR}/../node_modules/react-native"
    "${CMAKE_SOURCE_DIR}/node_modules/react-native"
    "${CMAKE_SOURCE_DIR}/template/node_modules/react-native"
  )
  foreach(_c IN LISTS _candidates)
    if(EXISTS "${_c}/package.json")
      set(REACT_NATIVE_ROOT "${_c}" CACHE PATH "Path to the react-native package" FORCE)
      break()
    endif()
  endforeach()
endif()

if(NOT REACT_NATIVE_ROOT OR NOT EXISTS "${REACT_NATIVE_ROOT}/package.json")
  message(FATAL_ERROR
    "Could not locate the react-native package.\n"
    "Pass -DREACT_NATIVE_ROOT=/path/to/node_modules/react-native when configuring.")
endif()

message(STATUS "Using react-native at ${REACT_NATIVE_ROOT}")

set(REACT_NATIVE_COMMON "${REACT_NATIVE_ROOT}/ReactCommon")
if(NOT EXISTS "${REACT_NATIVE_COMMON}")
  message(FATAL_ERROR
    "ReactCommon not found at ${REACT_NATIVE_COMMON}. Is this the right react-native version?")
endif()
