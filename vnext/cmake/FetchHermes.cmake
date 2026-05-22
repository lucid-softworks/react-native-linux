# FetchHermes.cmake — bring Hermes in via FetchContent and expose
# Hermes::Hermes as a link target. Pinned to a tag known to match the
# REACT_NATIVE peer-dep range; bump alongside RN.

if(REACT_NATIVE_LINUX_USE_SYSTEM_HERMES)
  find_library(HERMES_LIBRARY hermes REQUIRED)
  find_path(HERMES_INCLUDE hermes/hermes.h REQUIRED)
  add_library(Hermes::Hermes UNKNOWN IMPORTED)
  set_target_properties(Hermes::Hermes PROPERTIES
    IMPORTED_LOCATION "${HERMES_LIBRARY}"
    INTERFACE_INCLUDE_DIRECTORIES "${HERMES_INCLUDE}")
  message(STATUS "Using system Hermes: ${HERMES_LIBRARY}")
  return()
endif()

# Hermes commit that React Native 0.76.2 was built against. Source of
# truth: `node_modules/react-native/sdks/.hermesversion`, which is a
# string of the form `hermes-YYYY-MM-DD-RNvX.Y.Z-<sha>`. We pin the
# <sha> part directly because the literal `hermes-…-<sha>` string is
# RN's vendoring tag, not a tag on facebook/hermes.
set(HERMES_COMMIT "5b4aa20c719830dcf5684832b89a6edb95ac3d64"
    CACHE STRING "Hermes git commit to fetch (matches RN 0.76.2 .hermesversion)")

FetchContent_Declare(hermes
  GIT_REPOSITORY https://github.com/facebook/hermes.git
  GIT_TAG        ${HERMES_COMMIT}
  GIT_SHALLOW    FALSE   # GIT_SHALLOW requires a branch/tag, not a SHA
)

set(HERMES_BUILD_APPLE_FRAMEWORK OFF CACHE BOOL "" FORCE)
set(HERMES_BUILD_APPLE_DSYM OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_DEBUGGER ${REACT_NATIVE_LINUX_ENABLE_INSPECTOR} CACHE BOOL "" FORCE)
set(HERMES_ENABLE_TEST_SUITE OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_TOOLS OFF CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(hermes)

# Hermes exposes its JSI runtime as the `libhermes` target (since the
# 2023 cleanup that retired `hermesvm` from the public surface). Alias
# it under the Hermes::Hermes name our vnext/CMakeLists.txt uses.
if(NOT TARGET Hermes::Hermes)
  if(TARGET libhermes)
    add_library(Hermes::Hermes ALIAS libhermes)
  elseif(TARGET hermes)
    add_library(Hermes::Hermes ALIAS hermes)
  else()
    message(FATAL_ERROR
      "Hermes was fetched but neither `libhermes` nor `hermes` target exists. "
      "Has Hermes renamed its public library again?")
  endif()
endif()

message(STATUS "Hermes fetched at commit ${HERMES_COMMIT}")
