find_package(fmt QUIET)
if(fmt_FOUND)
  message(STATUS "Using system fmt")
  return()
endif()

set(FMT_TAG "10.2.1" CACHE STRING "fmt git tag")

FetchContent_Declare(fmt
  GIT_REPOSITORY https://github.com/fmtlib/fmt.git
  GIT_TAG        ${FMT_TAG}
  GIT_SHALLOW    TRUE
)

set(FMT_DOC OFF CACHE BOOL "" FORCE)
set(FMT_TEST OFF CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(fmt)
message(STATUS "fmt fetched at tag ${FMT_TAG}")
