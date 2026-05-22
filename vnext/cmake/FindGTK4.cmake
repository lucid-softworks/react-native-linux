# FindGTK4.cmake — wrap pkg-config gtk4 into an imported target.
# Usage: include(FindGTK4); target_link_libraries(... GTK4::GTK4).

pkg_check_modules(GTK4 REQUIRED IMPORTED_TARGET gtk4)

if(NOT TARGET GTK4::GTK4)
  add_library(GTK4::GTK4 INTERFACE IMPORTED)
  target_link_libraries(GTK4::GTK4 INTERFACE PkgConfig::GTK4)
endif()

message(STATUS "Found GTK4 version: ${GTK4_VERSION}")
