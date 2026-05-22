cmake_minimum_required(VERSION 3.25)
project(react_native_linux
  VERSION 0.0.1 # x-release-please-version
  DESCRIPTION "React Native for Linux native runtime"
  LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

list(APPEND CMAKE_MODULE_PATH "${CMAKE_CURRENT_SOURCE_DIR}/cmake")

option(REACT_NATIVE_LINUX_BUILD_TESTS "Build vnext unit tests" OFF)
option(REACT_NATIVE_LINUX_USE_SYSTEM_HERMES "Use system-installed Hermes instead of FetchContent" OFF)
option(REACT_NATIVE_LINUX_ENABLE_INSPECTOR "Enable Hermes Chrome inspector" ON)

# ------------------------------------------------------------------
# Dependencies
# ------------------------------------------------------------------
include(FetchContent)
include(GNUInstallDirs)

find_package(Threads REQUIRED)
find_package(PkgConfig REQUIRED)

include(FindGTK4)         # GTK4 via pkg-config
include(ReactNativeHeaders)  # locate node_modules/react-native
include(FetchHermes)      # Hermes runtime
include(FetchFolly)       # Folly (subset)
include(FetchGlog)        # glog
include(FetchFmt)         # fmt
include(FetchDoubleConversion)
include(FetchBoost)       # Boost (header-only subset)
include(Codegen)          # @react-native/codegen driver

# ------------------------------------------------------------------
# Sources
# ------------------------------------------------------------------
set(RNL_PUBLIC_HEADERS
  include/react-native-linux/RNLinuxApplication.h
  include/react-native-linux/RNLinuxHost.h
  include/react-native-linux/Logging.h
  include/react-native-linux/CrashHandler.h
)

set(RNL_SOURCES
  src/RNLinuxApplication.cpp
  src/RNLinuxHost.cpp
  src/Logging.cpp
  src/CrashHandler.cpp
  src/fabric/LinuxComponentDescriptorRegistry.cpp
  src/fabric/LinuxSchedulerDelegate.cpp
  src/fabric/LinuxMountingManager.cpp
  src/fabric/LinuxComponentView.cpp
  src/fabric/LinuxComponentViewRegistry.cpp
  src/jsi/HermesRuntimeFactory.cpp
  src/jsi/BundleLoader.cpp
  src/views/ViewComponentView.cpp
  src/views/ParagraphComponentView.cpp
  src/modules/PlatformConstants.cpp
  src/devtools/MetroReloadClient.cpp
)

add_library(react_native_linux ${RNL_SOURCES})
add_library(react_native_linux::react_native_linux ALIAS react_native_linux)

target_include_directories(react_native_linux
  PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<INSTALL_INTERFACE:${CMAKE_INSTALL_INCLUDEDIR}>
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${RN_LINUX_CODEGEN_OUTPUT_DIR}
    ${REACT_NATIVE_ROOT}/ReactCommon
    ${REACT_NATIVE_ROOT}/ReactCommon/jsi
    ${REACT_NATIVE_ROOT}/ReactCommon/react/renderer
)

if(RN_LINUX_CODEGEN_AVAILABLE)
  add_dependencies(react_native_linux react_native_linux_codegen)
endif()

target_link_libraries(react_native_linux
  PUBLIC
    GTK4::GTK4
  PRIVATE
    Threads::Threads
    Hermes::Hermes
    Folly::folly
    glog::glog
    fmt::fmt
    double-conversion::double-conversion
    Boost::headers
)

target_compile_features(react_native_linux PUBLIC cxx_std_20)
target_compile_definitions(react_native_linux PRIVATE
  RNL_PLATFORM_LINUX=1
  $<$<BOOL:${REACT_NATIVE_LINUX_ENABLE_INSPECTOR}>:HERMES_ENABLE_DEBUGGER=1>
)

# Treat warnings seriously in our own code only.
target_compile_options(react_native_linux PRIVATE
  -Wall -Wextra -Wpedantic
  -Wno-unused-parameter  # noisy with the many delegate methods
)

set_target_properties(react_native_linux PROPERTIES
  PUBLIC_HEADER "${RNL_PUBLIC_HEADERS}"
  VERSION ${PROJECT_VERSION}
  SOVERSION ${PROJECT_VERSION_MAJOR}
)

# ------------------------------------------------------------------
# Install
# ------------------------------------------------------------------
install(TARGETS react_native_linux
  EXPORT react_native_linuxTargets
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
  PUBLIC_HEADER DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/react-native-linux
)

install(EXPORT react_native_linuxTargets
  FILE react_native_linuxTargets.cmake
  NAMESPACE react_native_linux::
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/react_native_linux
)

# pkg-config descriptor for non-CMake consumers.
configure_file(
  ${CMAKE_CURRENT_SOURCE_DIR}/cmake/react-native-linux.pc.in
  ${CMAKE_CURRENT_BINARY_DIR}/react-native-linux.pc
  @ONLY)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/react-native-linux.pc
  DESTINATION ${CMAKE_INSTALL_LIBDIR}/pkgconfig)

if(REACT_NATIVE_LINUX_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
