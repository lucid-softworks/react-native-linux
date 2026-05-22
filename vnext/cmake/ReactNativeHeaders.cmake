# ReactNativeHeaders.cmake — locate the react-native npm package and expose
# its native source trees (ReactCommon, jsi, codegen output) for inclusion.

if(NOT DEFINED REACT_NATIVE_ROOT)
  # 1. Try the consuming app's node_modules (most common when the template's
  #    linux/CMakeLists.txt brings us in).
  set(_candidates
    "${CMAKE_SOURCE_DIR}/../node_modules/react-native"
    "${CMAKE_CURRENT_SOURCE_DIR}/../node_modules/react-native"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../node_modules/react-native"
    "${CMAKE_CURRENT_SOURCE_DIR}/../../../node_modules/react-native"
  )
  foreach(_c IN LISTS _candidates)
    if(EXISTS "${_c}/package.json")
      set(REACT_NATIVE_ROOT "${_c}" CACHE PATH "Path to the react-native package")
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
