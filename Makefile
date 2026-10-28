UUID    := nexnotch@nexvar
PREFIX  := $(HOME)/.local/share/gnome-shell/extensions
DEST    := $(PREFIX)/$(UUID)
FILES   := metadata.json extension.js notch.js prefs.js stylesheet.css \
           modules schemas icons

.PHONY: all compile-schemas install uninstall pack reload enable disable logs clean kde kde-install kde-uninstall kde-run

all: compile-schemas

compile-schemas:
	glib-compile-schemas schemas/

install: compile-schemas
	mkdir -p "$(DEST)"
	cp -r $(FILES) "$(DEST)/"

uninstall:
	rm -rf "$(DEST)"

pack:
	rm -f $(UUID).shell-extension.zip schemas/gschemas.compiled
	gnome-extensions pack \
	    --extra-source=notch.js \
	    --extra-source=modules \
	    --extra-source=icons \
	    --extra-source=README.md \
	    --extra-source=LICENSE \
	    --schema=schemas/org.gnome.shell.extensions.nexnotch.gschema.xml \
	    --force
	@echo "Built $(UUID).shell-extension.zip"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

reload: install
	@echo "Log out / log in (Wayland) or press Alt+F2 → r (X11) to reload GNOME Shell."

logs:
	journalctl -f -o cat /usr/bin/gnome-shell

# ——— KDE Plasma 6 (the Qt/QML app in kde/) ———
KDE_BUILD  := kde/build
KDE_PREFIX ?= $(HOME)/.local

kde:
	cmake -S kde -B $(KDE_BUILD) -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo -DCMAKE_INSTALL_PREFIX=$(KDE_PREFIX)
	cmake --build $(KDE_BUILD)

kde-install: kde
	@if [ -x $(KDE_PREFIX)/bin/nexnotch-kde ]; then $(KDE_PREFIX)/bin/nexnotch-kde --quit; fi
	@# --quit returns before the old one has gone; a new one started meanwhile would just hand over to it
	@for i in $$(seq 50); do pgrep -x nexnotch-kde >/dev/null || break; sleep 0.1; done
	cmake --install $(KDE_BUILD)
	setsid -f $(KDE_PREFIX)/bin/nexnotch-kde >/dev/null 2>&1
	@echo "NexNotch is running and starts at login. Settings: nexnotch-kde --settings"

kde-uninstall:
	@if [ -x $(KDE_PREFIX)/bin/nexnotch-kde ]; then $(KDE_PREFIX)/bin/nexnotch-kde --quit; fi
	rm -f $(KDE_PREFIX)/bin/nexnotch-kde $(KDE_PREFIX)/share/applications/io.nexvar.NexNotch.desktop \
	      $(KDE_PREFIX)/share/icons/hicolor/scalable/apps/io.nexvar.NexNotch.svg \
	      $(HOME)/.config/autostart/io.nexvar.NexNotch.desktop

kde-run: kde
	$(KDE_BUILD)/nexnotch-kde

clean:
	rm -f schemas/gschemas.compiled
	rm -f $(UUID).shell-extension.zip
