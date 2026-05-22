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

set(HERMES_TAG "hermes-2024-09-10-RNv0.76.0-5b143ad4dcb6e07d99b71b88bf95e35cefcae092"
    CACHE STRING "Hermes git tag to fetch")

FetchContent_Declare(hermes
  GIT_REPOSITORY https://github.com/facebook/hermes.git
  GIT_TAG        ${HERMES_TAG}
  GIT_SHALLOW    TRUE
)

set(HERMES_BUILD_APPLE_FRAMEWORK OFF CACHE BOOL "" FORCE)
set(HERMES_BUILD_APPLE_DSYM OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_DEBUGGER ${REACT_NATIVE_LINUX_ENABLE_INSPECTOR} CACHE BOOL "" FORCE)
set(HERMES_ENABLE_TEST_SUITE OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_TOOLS OFF CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(hermes)

if(NOT TARGET Hermes::Hermes)
  add_library(Hermes::Hermes ALIAS hermesvm)
endif()

message(STATUS "Hermes fetched at tag ${HERMES_TAG}")
