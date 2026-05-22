cmake_minimum_required(VERSION 3.25)
project(rn_linux_app LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# Locate the react-native-linux native runtime. By default we expect a sibling
# checkout via node_modules, but consumers can override REACT_NATIVE_LINUX_DIR.
if(NOT DEFINED REACT_NATIVE_LINUX_DIR)
  set(REACT_NATIVE_LINUX_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../node_modules/@lucid-softworks/react-native-linux/vnext")
endif()

if(NOT EXISTS "${REACT_NATIVE_LINUX_DIR}/CMakeLists.txt")
  message(FATAL_ERROR
    "react-native-linux native runtime not found at ${REACT_NATIVE_LINUX_DIR}.\n"
    "Pass -DREACT_NATIVE_LINUX_DIR=/path/to/react-native-linux/vnext when configuring.")
endif()

add_subdirectory(${REACT_NATIVE_LINUX_DIR} react_native_linux_build)

add_executable(rn-linux-app main.cpp)
target_link_libraries(rn-linux-app PRIVATE react_native_linux)
target_compile_features(rn-linux-app PRIVATE cxx_std_20)

# Copy the JS bundle next to the executable for offline runs.
if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../linux/build/assets/index.linux.bundle")
  add_custom_command(TARGET rn-linux-app POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy
      "${CMAKE_CURRENT_SOURCE_DIR}/build/assets/index.linux.bundle"
      "$<TARGET_FILE_DIR:rn-linux-app>/index.linux.bundle")
endif()

install(TARGETS rn-linux-app RUNTIME DESTINATION bin)
install(FILES app.desktop DESTINATION share/applications)
