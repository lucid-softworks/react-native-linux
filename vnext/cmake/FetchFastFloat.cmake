# FetchFastFloat.cmake — RN 0.81's renderer uses `fast_float`'s
# `chars_format::allow_leading_plus` (added in fast_float 6.x) when
# parsing CSS numbers. Ubuntu 24.04 only ships fast_float 3.9.0 via
# `libfast-float-dev`, which is too old AND has a CMake config that
# `find_package(FastFloat)` would match — so we skip the system path
# entirely and always FetchContent at the version RN 0.81 pins in
# `third-party-podspecs/fast_float.podspec`.

set(FAST_FLOAT_TAG "v8.0.0" CACHE STRING "fast_float git tag (matches RN 0.81)")

FetchContent_Declare(fast_float
  GIT_REPOSITORY https://github.com/fastfloat/fast_float.git
  GIT_TAG        ${FAST_FLOAT_TAG}
  GIT_SHALLOW    TRUE
)

set(FASTFLOAT_TEST OFF CACHE BOOL "" FORCE)
set(FASTFLOAT_INSTALL OFF CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(fast_float)

# Build a fresh INTERFACE target that owns the include path explicitly,
# so consumers that link FastFloat::fast_float get the v8 headers ahead
# of /usr/include (where libfast-float-dev's 3.9.0 lives). The upstream
# `fast_float` target alone is fine on a clean system but doesn't beat
# the implicit /usr/include search order, so we need to be loud about
# the path.
if(NOT TARGET FastFloat::fast_float)
  add_library(FastFloat::fast_float INTERFACE IMPORTED)
  # Wrap in $<BUILD_INTERFACE:> so consumers that are exported
  # downstream (Folly's `folly_deps`, for instance) don't pick up the
  # build-tree path on their INTERFACE_INCLUDE_DIRECTORIES export —
  # CMake rejects that with "prefixed in the build directory".
  set_target_properties(FastFloat::fast_float PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES
      "$<BUILD_INTERFACE:${fast_float_SOURCE_DIR}/include>")
endif()

# Deliberately do NOT export FASTFLOAT_INCLUDE_DIR into the global
# cache here — Folly's FindFastFloat would pick it up and bake the
# build-tree path into its exported `folly_deps` target, which CMake
# refuses. Folly happily uses the system fast_float 3.9.0 for its own
# internal needs; only the RN 0.81 renderer needs the v8 headers, and
# it gets them by linking FastFloat::fast_float above.

message(STATUS "fast_float fetched at tag ${FAST_FLOAT_TAG} "
               "(include: ${fast_float_SOURCE_DIR}/include)")
