# We only need Boost headers (filesystem, asio bits used transitively by Folly).
find_package(Boost QUIET)
if(Boost_FOUND)
  if(NOT TARGET Boost::headers)
    add_library(Boost::headers INTERFACE IMPORTED)
    set_target_properties(Boost::headers PROPERTIES
      INTERFACE_INCLUDE_DIRECTORIES "${Boost_INCLUDE_DIRS}")
  endif()
  message(STATUS "Using system Boost ${Boost_VERSION}")
  return()
endif()

set(BOOST_VERSION "1.84.0" CACHE STRING "Boost version")
set(BOOST_URL "https://github.com/boostorg/boost/releases/download/boost-${BOOST_VERSION}/boost-${BOOST_VERSION}.tar.xz")

FetchContent_Declare(Boost
  URL ${BOOST_URL}
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
)

set(BOOST_INCLUDE_LIBRARIES "intrusive;variant;optional;preprocessor;mpl;type_traits" CACHE STRING "" FORCE)
FetchContent_MakeAvailable(Boost)

if(NOT TARGET Boost::headers)
  add_library(Boost::headers INTERFACE IMPORTED)
  set_target_properties(Boost::headers PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "${boost_SOURCE_DIR}")
endif()
