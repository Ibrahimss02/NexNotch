cmake_minimum_required(VERSION 3.20)
project(nexnotch-kde VERSION 1.5.2 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

include(GNUInstallDirs)

find_package(Qt6 6.6 REQUIRED COMPONENTS Core Gui Quick QuickControls2 DBus Network Concurrent Widgets)
find_package(LayerShellQt REQUIRED)
find_package(KF6GlobalAccel REQUIRED)
find_package(KF6GuiAddons REQUIRED)
find_package(KF6WindowSystem REQUIRED)
find_package(KF6Service REQUIRED)
find_package(KF6KIO REQUIRED)
find_package(KF6Config REQUIRED)
find_package(KF6CoreAddons REQUIRED)

qt_standard_project_setup(REQUIRES 6.6)
qt_policy(SET QTP0004 NEW)

qt_add_executable(nexnotch-kde
    src/main.cpp
    src/sys.cpp src/sys.h
    src/dbusbridge.cpp src/dbusbridge.h
    src/notifications.cpp src/notifications.h
    src/notchwindow.cpp src/notchwindow.h
    src/windows.cpp src/windows.h
    src/oauth.cpp src/oauth.h
)

file(GLOB_RECURSE NEXNOTCH_QML RELATIVE ${CMAKE_CURRENT_SOURCE_DIR} CONFIGURE_DEPENDS qml/*.qml qml/*.js)
# the GNOME extension's own icons, shared rather than copied
file(GLOB NEXNOTCH_ICONS CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/../icons/*.svg)

# The QML lives under qml/ on disk; strip that so files resolve as qrc:/qt/qml/NexNotch/<name>,
# where the engine finds the module without anything installed beside the binary.
foreach(f IN LISTS NEXNOTCH_QML)
    string(REGEX REPLACE "^qml/" "" alias "${f}")
    set_source_files_properties(${f} PROPERTIES QT_RESOURCE_ALIAS "${alias}")
endforeach()
foreach(f IN LISTS NEXNOTCH_ICONS)
    get_filename_component(name ${f} NAME)
    set_source_files_properties(${f} PROPERTIES QT_RESOURCE_ALIAS "icons/${name}")
endforeach()
foreach(f IN LISTS NEXNOTCH_QML)
    get_filename_component(name ${f} NAME)
    if(name MATCHES "^(Theme|Config|Services)\\.qml$")
        set_source_files_properties(${f} PROPERTIES QT_QML_SINGLETON_TYPE TRUE)
    endif()
endforeach()

qt_add_qml_module(nexnotch-kde
    URI NexNotch
    VERSION 1.0
    QML_FILES ${NEXNOTCH_QML}
    RESOURCES ${NEXNOTCH_ICONS}
)

target_include_directories(nexnotch-kde PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_compile_definitions(nexnotch-kde PRIVATE NEXNOTCH_VERSION="${PROJECT_VERSION}")

target_link_libraries(nexnotch-kde PRIVATE
    Qt6::Core Qt6::Gui Qt6::Quick Qt6::QuickControls2 Qt6::DBus Qt6::Network Qt6::Concurrent Qt6::Widgets
    LayerShellQt::Interface
    KF6::GlobalAccel KF6::GuiAddons KF6::WindowSystem KF6::Service KF6::KIOGui KF6::ConfigCore KF6::CoreAddons
)

install(TARGETS nexnotch-kde RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
configure_file(data/io.nexvar.NexNotch.desktop.in ${CMAKE_CURRENT_BINARY_DIR}/io.nexvar.NexNotch.desktop @ONLY)
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/io.nexvar.NexNotch.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)
install(FILES data/nexnotch.svg DESTINATION ${CMAKE_INSTALL_DATADIR}/icons/hicolor/scalable/apps RENAME io.nexvar.NexNotch.svg)
