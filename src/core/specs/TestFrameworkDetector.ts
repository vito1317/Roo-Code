/**
 * TestFrameworkDetector - Auto-detect test framework based on project configuration files
 * 
 * Supports: PHPUnit, Jest, Vitest, pytest, Mocha, RSpec, Go testing, Rust testing
 */

import * as fs from "fs"
import * as path from "path"

export interface TestFramework {
	name: string
	language: string
	testFilePattern: string
	testDirectory: string
	testAnnotation: string
	sampleTest: string
	runCommand: string
}

const TEST_FRAMEWORKS: Record<string, TestFramework> = {
	phpunit: {
		name: "PHPUnit",
		language: "php",
		testFilePattern: "*Test.php",
		testDirectory: "tests",
		testAnnotation: "/** @test */",
		sampleTest: `/** @test */
public function it_should_do_something(): void
{
    // Arrange
    
    // Act
    
    // Assert
    $this->assertTrue(true);
}`,
		runCommand: "php artisan test",
	},
	jest: {
		name: "Jest",
		language: "javascript",
		testFilePattern: "*.test.{js,ts,jsx,tsx}",
		testDirectory: "__tests__",
		testAnnotation: "test('', () => {})",
		sampleTest: `test('should do something', () => {
    // Arrange
    
    // Act
    
    // Assert
    expect(true).toBe(true);
});`,
		runCommand: "npm test",
	},
	vitest: {
		name: "Vitest",
		language: "typescript",
		testFilePattern: "*.test.{ts,tsx}",
		testDirectory: "__tests__",
		testAnnotation: "test('', () => {})",
		sampleTest: `import { describe, test, expect } from 'vitest';

test('should do something', () => {
    // Arrange
    
    // Act
    
    // Assert
    expect(true).toBe(true);
});`,
		runCommand: "npm run test",
	},
	pytest: {
		name: "pytest",
		language: "python",
		testFilePattern: "test_*.py",
		testDirectory: "tests",
		testAnnotation: "def test_",
		sampleTest: `def test_should_do_something():
    # Arrange
    
    # Act
    
    # Assert
    assert True`,
		runCommand: "pytest",
	},
	mocha: {
		name: "Mocha",
		language: "javascript",
		testFilePattern: "*.spec.{js,ts}",
		testDirectory: "test",
		testAnnotation: "it('', () => {})",
		sampleTest: `describe('Feature', () => {
    it('should do something', () => {
        // Arrange
        
        // Act
        
        // Assert
        expect(true).to.be.true;
    });
});`,
		runCommand: "npm test",
	},
	rspec: {
		name: "RSpec",
		language: "ruby",
		testFilePattern: "*_spec.rb",
		testDirectory: "spec",
		testAnnotation: "it '' do",
		sampleTest: `RSpec.describe 'Feature' do
  it 'should do something' do
    # Arrange
    
    # Act
    
    # Assert
    expect(true).to be true
  end
end`,
		runCommand: "bundle exec rspec",
	},
	go: {
		name: "Go testing",
		language: "go",
		testFilePattern: "*_test.go",
		testDirectory: "",
		testAnnotation: "func Test",
		sampleTest: `func TestShouldDoSomething(t *testing.T) {
    // Arrange
    
    // Act
    
    // Assert
    if true != true {
        t.Error("Expected true")
    }
}`,
		runCommand: "go test ./...",
	},
}

const DETECTION_FILES: Record<string, string> = {
	"phpunit.xml": "phpunit",
	"phpunit.xml.dist": "phpunit",
	"jest.config.js": "jest",
	"jest.config.ts": "jest",
	"jest.config.mjs": "jest",
	"jest.config.cjs": "jest",
	"vitest.config.ts": "vitest",
	"vitest.config.js": "vitest",
	"vitest.config.mts": "vitest",
	"pytest.ini": "pytest",
	"pyproject.toml": "pytest", // Check for [tool.pytest] section
	"setup.cfg": "pytest",
	".mocharc.json": "mocha",
	".mocharc.js": "mocha",
	".mocharc.yml": "mocha",
	"spec/spec_helper.rb": "rspec",
	".rspec": "rspec",
	"go.mod": "go",
}

export class TestFrameworkDetector {
	private workspacePath: string

	constructor(workspacePath: string) {
		this.workspacePath = workspacePath
	}

	/**
	 * Detect the primary test framework used in the project
	 */
	detect(): TestFramework | null {
		// Check for detection files
		for (const [file, frameworkKey] of Object.entries(DETECTION_FILES)) {
			const filePath = path.join(this.workspacePath, file)
			if (fs.existsSync(filePath)) {
				console.log(`[TestFrameworkDetector] Detected ${frameworkKey} via ${file}`)
				return TEST_FRAMEWORKS[frameworkKey]
			}
		}

		// Check package.json for test dependencies
		const packageJsonPath = path.join(this.workspacePath, "package.json")
		if (fs.existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
				const allDeps = {
					...packageJson.dependencies,
					...packageJson.devDependencies,
				}

				if (allDeps.vitest) {
					console.log("[TestFrameworkDetector] Detected vitest via package.json")
					return TEST_FRAMEWORKS.vitest
				}
				if (allDeps.jest) {
					console.log("[TestFrameworkDetector] Detected jest via package.json")
					return TEST_FRAMEWORKS.jest
				}
				if (allDeps.mocha) {
					console.log("[TestFrameworkDetector] Detected mocha via package.json")
					return TEST_FRAMEWORKS.mocha
				}
			} catch (e) {
				console.error("[TestFrameworkDetector] Error parsing package.json:", e)
			}
		}

		// Check composer.json for PHP dependencies
		const composerJsonPath = path.join(this.workspacePath, "composer.json")
		if (fs.existsSync(composerJsonPath)) {
			try {
				const composerJson = JSON.parse(fs.readFileSync(composerJsonPath, "utf-8"))
				const allDeps = {
					...composerJson.require,
					...composerJson["require-dev"],
				}

				if (allDeps["phpunit/phpunit"]) {
					console.log("[TestFrameworkDetector] Detected phpunit via composer.json")
					return TEST_FRAMEWORKS.phpunit
				}
			} catch (e) {
				console.error("[TestFrameworkDetector] Error parsing composer.json:", e)
			}
		}

		// Check requirements.txt for Python dependencies
		const requirementsPath = path.join(this.workspacePath, "requirements.txt")
		if (fs.existsSync(requirementsPath)) {
			try {
				const requirements = fs.readFileSync(requirementsPath, "utf-8")
				if (requirements.toLowerCase().includes("pytest")) {
					console.log("[TestFrameworkDetector] Detected pytest via requirements.txt")
					return TEST_FRAMEWORKS.pytest
				}
			} catch (e) {
				console.error("[TestFrameworkDetector] Error reading requirements.txt:", e)
			}
		}

		console.log("[TestFrameworkDetector] No test framework detected")
		return null
	}

	/**
	 * Get a list of all detected test frameworks
	 */
	detectAll(): TestFramework[] {
		const frameworks: TestFramework[] = []
		const detected = new Set<string>()

		for (const [file, frameworkKey] of Object.entries(DETECTION_FILES)) {
			const filePath = path.join(this.workspacePath, file)
			if (fs.existsSync(filePath) && !detected.has(frameworkKey)) {
				frameworks.push(TEST_FRAMEWORKS[frameworkKey])
				detected.add(frameworkKey)
			}
		}

		return frameworks
	}

	/**
	 * Generate test template for a given acceptance criteria
	 */
	generateTestTemplate(acceptanceCriteria: string[], framework?: TestFramework): string {
		const fw = framework || this.detect() || TEST_FRAMEWORKS.jest

		const tests = acceptanceCriteria.map((criteria) => {
			// Convert criteria to test function name
			const testName = this.criteriaToTestName(criteria)
			return this.generateSingleTest(testName, criteria, fw)
		})

		return tests.join("\n\n")
	}

	private criteriaToTestName(criteria: string): string {
		// Remove common prefixes and convert to snake_case
		let name = criteria
			.replace(/^[-\s]*\[[ x✓✔☑]*\]\s*/i, "") // Remove checkbox
			.replace(/應該|必須|可以|能夠/g, "") // Remove Chinese modal verbs
			.replace(/should|must|can|able to/gi, "") // Remove English modal verbs
			.replace(/[^\w\u4e00-\u9fa5\s]/g, "") // Keep only alphanumeric, Chinese, and spaces
			.trim()
			.replace(/\s+/g, "_")
			.toLowerCase()

		return `test_${name.substring(0, 60)}`
	}

	private generateSingleTest(testName: string, criteria: string, framework: TestFramework): string {
		switch (framework.name) {
			case "PHPUnit":
				return `/** @test */
public function ${testName}(): void
{
    // Acceptance: ${criteria}
    // Arrange
    
    // Act
    
    // Assert
    $this->assertTrue(true);
}`
			case "Jest":
			case "Vitest":
				return `test('${criteria}', () => {
    // Arrange
    
    // Act
    
    // Assert
    expect(true).toBe(true);
});`
			case "pytest":
				return `def ${testName}():
    """${criteria}"""
    # Arrange
    
    # Act
    
    # Assert
    assert True`
			case "Go testing":
				return `func ${this.toPascalCase(testName)}(t *testing.T) {
    // ${criteria}
    // Arrange
    
    // Act
    
    // Assert
}`
			default:
				return `// Test: ${criteria}
// TODO: Implement test`
		}
	}

	private toPascalCase(str: string): string {
		return str
			.split("_")
			.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
			.join("")
	}
}

/**
 * Quick helper function to detect test framework for a workspace
 */
export function detectTestFramework(workspacePath: string): TestFramework | null {
	const detector = new TestFrameworkDetector(workspacePath)
	return detector.detect()
}
