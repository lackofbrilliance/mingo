
all: clean compile test build

test:
	@tape test/*.js

clean:
	@rm -fr dist/*

compile:
	@node_modules/babel-cli/bin/babel.js mingo-es5x.js -o mingo.js

build: clean compile test
	@mkdir -p dist/
	@uglifyjs mingo.js -c -m -o dist/mingo.min.js --source-map dist/mingo.min.map
	@gzip -kf dist/mingo.min.js
	@echo "\033[0;32mBUILD SUCCEEDED"

.PHONY: clean test build
