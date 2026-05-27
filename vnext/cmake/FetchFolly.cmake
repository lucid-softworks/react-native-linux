# FetchFolly.cmake — Folly is one of the heavier React Native C++ deps.
# Building the full Folly is overkill for us; for now we use the subset that
# RN ships under node_modules/react-native/third-party-podspecs/ on iOS and
# the prebuilt folly_runtime on Android. On Linux we have to do the work.
#
# Strategy: prefer system-installed `libfolly-dev` (Debian/Ubuntu has it as
# `libfolly-dev`), fall back to FetchContent.

find_package(folly QUIET)
if(folly_FOUND)
  if(NOT TARGET Folly::folly)
    add_library(Folly::folly ALIAS folly)
  endif()
  message(STATUS "Using system Folly")
  return()
endif()

pkg_check_modules(FOLLY QUIET IMPORTED_TARGET libfolly)
if(FOLLY_FOUND)
  add_library(Folly::folly ALIAS PkgConfig::FOLLY)
  message(STATUS "Using pkg-config Folly")
  return()
endif()

# Fallback: FetchContent. This is slow on first configure (~5-10 min) and
# pulls in fmt, glog, gflags, gtest, etc. Pinned to the tag RN 0.81's
# CocoaPods helpers use (`react_native_pods.rb` → folly_config[:version]).
set(FOLLY_TAG "v2024.11.18.00" CACHE STRING "Folly git tag")

FetchContent_Declare(folly
  GIT_REPOSITORY https://github.com/facebook/folly.git
  GIT_TAG        ${FOLLY_TAG}
  GIT_SHALLOW    TRUE
)

set(BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(FOLLY_NO_EXCEPTION_TRACER ON CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(folly)

if(NOT TARGET Folly::folly)
  add_library(Folly::folly ALIAS folly)
endif()

message(STATUS "Folly fetched at tag ${FOLLY_TAG}")
