find_package(double-conversion QUIET)
if(double-conversion_FOUND)
  message(STATUS "Using system double-conversion")
  return()
endif()

set(DC_TAG "v3.3.0" CACHE STRING "double-conversion git tag")

FetchContent_Declare(double-conversion
  GIT_REPOSITORY https://github.com/google/double-conversion.git
  GIT_TAG        ${DC_TAG}
  GIT_SHALLOW    TRUE
)

FetchContent_MakeAvailable(double-conversion)

if(NOT TARGET double-conversion::double-conversion)
  add_library(double-conversion::double-conversion ALIAS double-conversion)
endif()
