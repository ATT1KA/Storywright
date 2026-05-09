.PHONY: help setup install dev build preview test test-clamp test-validate test-context-budget validate clean reset

# Default target — run `make` with no args to see the menu.
help:
	@echo "Storywright — make targets"
	@echo ""
	@echo "  make setup            Run scripts/setup.sh (prereq check + install)"
	@echo "  make install          Install npm dependencies (npm ci, fallback to npm install)"
	@echo "  make dev              Start the Vite dev server (http://localhost:5173)"
	@echo "  make build            Build for production into dist/"
	@echo "  make preview          Preview the production build locally"
	@echo "  make test             Run the full test suite"
	@echo "    make test-clamp           – clamp/strategy tests only"
	@echo "    make test-validate        – ontology validator tests only"
	@echo "    make test-context-budget  – LLM context-budget tests only"
	@echo "  make validate         Validate the story-bible template against the constraint registry"
	@echo "  make clean            Remove dist/ build output"
	@echo "  make reset            Remove dist/ and node_modules/ (full reinstall starting point)"
	@echo ""

setup:
	@bash scripts/setup.sh

install:
	@if [ -f package-lock.json ]; then \
		npm ci --no-audit --no-fund || npm install --no-audit --no-fund; \
	else \
		npm install --no-audit --no-fund; \
	fi

dev:
	@npm run dev

build:
	@npm run build

preview:
	@npm run preview

test: test-clamp test-validate test-context-budget
	@echo ""
	@echo "All test suites passed."

test-clamp:
	@npm run test:clamp

test-validate:
	@npm run test:validate

test-context-budget:
	@npm run test:context-budget

validate:
	@npm run validate:bible

clean:
	@rm -rf dist
	@echo "Removed dist/"

reset:
	@rm -rf dist node_modules
	@echo "Removed dist/ and node_modules/. Run 'make install' to reinstall."
