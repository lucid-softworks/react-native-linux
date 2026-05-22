# Native test target for react-native-linux.
#
# Enable with -DREACT_NATIVE_LINUX_BUILD_TESTS=ON. CTest integration runs
# under `ctest --output-on-failure` from the build dir.
#
# Add a new test:
#   1. Drop the .cpp under vnext/tests/.
#   2. Append it to RNL_TEST_SOURCES below.
#   3. (Optional) add ASAN/UBSAN flags via target_compile_options.

include(FetchContent)

FetchContent_Declare(
  googletest
  GIT_REPOSITORY https://github.com/google/googletest.git
  GIT_TAG v1.15.2
)
set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(googletest)

set(RNL_TEST_SOURCES
  ComponentViewRegistryTest.cpp
)

add_executable(react_native_linux_tests ${RNL_TEST_SOURCES})

target_include_directories(react_native_linux_tests
  PRIVATE
    ${CMAKE_SOURCE_DIR}/src
    ${CMAKE_SOURCE_DIR}/include)

target_link_libraries(react_native_linux_tests
  PRIVATE
    react_native_linux
    GTest::gtest
    GTest::gtest_main
    GTest::gmock)

include(GoogleTest)
gtest_discover_tests(react_native_linux_tests
  PROPERTIES LABELS "vnext")
