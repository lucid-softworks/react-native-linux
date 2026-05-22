cmake_minimum_required(VERSION 3.25)
project(rn_linux_playground LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Inside a generated app this points at the published @lucid-softworks/
# react-native-linux package. Inside this monorepo we point it at vnext/
# directly so the playground tracks main.
if(NOT DEFINED REACT_NATIVE_LINUX_DIR)
  if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../../../vnext/CMakeLists.txt")
    set(REACT_NATIVE_LINUX_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../vnext")
  else()
    set(REACT_NATIVE_LINUX_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../node_modules/@lucid-softworks/react-native-linux/vnext")
  endif()
endif()

if(NOT EXISTS "${REACT_NATIVE_LINUX_DIR}/CMakeLists.txt")
  message(FATAL_ERROR
    "react-native-linux native runtime not found at ${REACT_NATIVE_LINUX_DIR}.\n"
    "Pass -DREACT_NATIVE_LINUX_DIR=/path/to/react-native-linux/vnext when configuring.")
endif()

add_subdirectory(${REACT_NATIVE_LINUX_DIR} react_native_linux_build)

# Pulled in by `react-native autolink-linux`.
include(${CMAKE_CURRENT_SOURCE_DIR}/build/autolinked.cmake OPTIONAL)

add_executable(rn-linux-playground main.cpp)
target_link_libraries(rn-linux-playground PRIVATE
  react_native_linux
  ${RN_LINUX_AUTOLINKED_TARGETS})
target_compile_features(rn-linux-playground PRIVATE cxx_std_20)

install(TARGETS rn-linux-playground RUNTIME DESTINATION bin)
install(FILES playground.desktop DESTINATION share/applications)
