find_package(glog QUIET)
if(glog_FOUND)
  message(STATUS "Using system glog")
  return()
endif()

set(GLOG_TAG "v0.7.1" CACHE STRING "glog git tag")

FetchContent_Declare(glog
  GIT_REPOSITORY https://github.com/google/glog.git
  GIT_TAG        ${GLOG_TAG}
  GIT_SHALLOW    TRUE
)

set(WITH_GFLAGS OFF CACHE BOOL "" FORCE)
set(WITH_GTEST OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

FetchContent_MakeAvailable(glog)
message(STATUS "glog fetched at tag ${GLOG_TAG}")
