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

# Hermes commit that React Native 0.81 was built against. Source of
# truth: `node_modules/react-native/sdks/.hermesversion`, which is a
# string of the form `hermes-YYYY-MM-DD-RNvX.Y.Z-<sha>`. We pin the
# <sha> part directly because the literal `hermes-…-<sha>` string is
# RN's vendoring tag, not a tag on facebook/hermes.
set(HERMES_COMMIT "e0fc67142ec0763c6b6153ca2bf96df815539782"
    CACHE STRING "Hermes git commit to fetch (matches RN 0.81 .hermesversion)")

FetchContent_Declare(hermes
  GIT_REPOSITORY https://github.com/facebook/hermes.git
  GIT_TAG        ${HERMES_COMMIT}
  GIT_SHALLOW    FALSE   # GIT_SHALLOW requires a branch/tag, not a SHA
)

set(HERMES_BUILD_APPLE_FRAMEWORK OFF CACHE BOOL "" FORCE)
set(HERMES_BUILD_APPLE_DSYM OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_DEBUGGER ${REACT_NATIVE_LINUX_ENABLE_INSPECTOR} CACHE BOOL "" FORCE)
set(HERMES_ENABLE_TEST_SUITE OFF CACHE BOOL "" FORCE)
# HERMES_ENABLE_TOOLS=ON is required at build time even though we don't
# ship hermesc/hbcdump: Hermes pre-compiles `InternalBytecode` at build
# time using its own hermesc, and the rule fails with a missing-rule
# ninja error when tools are disabled.
set(HERMES_ENABLE_TOOLS ON CACHE BOOL "" FORCE)

# Workaround: Hermes' CDP sources (e.g. API/hermes/cdp/DomainState.cpp)
# rely on std::string / std::vector / std::memory being pulled in
# transitively by other headers — true for older libstdc++ but not for
# the libstdc++ 13 that ships in Ubuntu 24.04. The result is
# "incomplete type std::__cxx11::basic_string<char>" errors.
#
# Force-include the missing standard headers for every Hermes
# translation unit by tweaking CMAKE_CXX_FLAGS just around the
# add_subdirectory that FetchContent_MakeAvailable performs. Restore
# afterwards so our own code isn't affected.
set(_rnl_save_cxx_flags "${CMAKE_CXX_FLAGS}")
if(CMAKE_CXX_COMPILER_ID STREQUAL "GNU" OR CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
  set(CMAKE_CXX_FLAGS
    "${CMAKE_CXX_FLAGS} -include cstdint -include cstring -include string -include memory -include vector")
endif()

FetchContent_MakeAvailable(hermes)

set(CMAKE_CXX_FLAGS "${_rnl_save_cxx_flags}")

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
