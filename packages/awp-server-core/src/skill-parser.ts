/**
 * AWP Server Core - Skill Parser
 *
 * Parses SKILL.md files with YAML frontmatter.
 */

import type { DefinedSkill, SkillFrontmatter } from "./types.ts";

/**
 * Parse a SKILL.md file content into a DefinedSkill
 *
 * @param id - Skill identifier
 * @param content - Full SKILL.md file content
 * @returns Parsed skill definition
 */
export function parseSkill(id: string, content: string): DefinedSkill {
  const frontmatter = parseFrontmatter(content);

  return {
    id,
    frontmatter,
    content,
  };
}

/**
 * Parse YAML frontmatter from markdown content
 *
 * Expects content in format:
 * ```
 * ---
 * name: Skill Name
 * description: Skill description
 * ...
 * ---
 *
 * # Markdown content...
 * ```
 */
function parseFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match || !match[1]) {
    return { name: "Unknown Skill" };
  }

  const yamlContent = match[1];
  const frontmatter: Record<string, unknown> = {};

  // Simple YAML parser for skill frontmatter
  for (const line of yamlContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Handle array values (like allowed-tools)
    if (trimmed.startsWith("- ")) {
      // This is an array item, find the previous key and add to it
      const keys = Object.keys(frontmatter);
      const lastKey = keys[keys.length - 1];
      if (lastKey && Array.isArray(frontmatter[lastKey])) {
        (frontmatter[lastKey] as string[]).push(trimmed.slice(2).trim());
      }
      continue;
    }

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value: string | string[] = trimmed.slice(colonIndex + 1).trim();

    // Check if next line starts an array
    if (value === "") {
      // Value might be on next lines as array
      frontmatter[key] = [];
    } else {
      frontmatter[key] = value;
    }
  }

  return {
    name: (frontmatter.name as string) ?? "Unknown Skill",
    description: frontmatter.description as string | undefined,
    version: frontmatter.version as string | undefined,
    "allowed-tools": frontmatter["allowed-tools"] as string[] | undefined,
  };
}

/**
 * Load skills from an object map of id -> content
 *
 * @param skillsMap - Map of skill ID to SKILL.md content
 * @returns Array of parsed skills
 */
export function loadSkillsFromMap(skillsMap: Record<string, string>): DefinedSkill[] {
  return Object.entries(skillsMap).map(([id, content]) => parseSkill(id, content));
}
