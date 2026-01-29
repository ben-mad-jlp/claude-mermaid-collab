/**
 * Kodex API Routes Test Suite
 * Tests REST API endpoints for Kodex knowledge management
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleKodexAPI } from '../kodex-api.js';
import type { TopicMetadata } from '../../services/kodex-manager.js';

// Create mock implementations
const mockListTopics = vi.fn();
const mockGetTopic = vi.fn();
const mockCreateTopic = vi.fn();
const mockUpdateTopic = vi.fn();
const mockDeleteTopic = vi.fn();
const mockVerifyTopic = vi.fn();
const mockListDrafts = vi.fn();
const mockApproveDraft = vi.fn();
const mockRejectDraft = vi.fn();
const mockListFlags = vi.fn();
const mockUpdateFlagStatus = vi.fn();
const mockCreateFlag = vi.fn();
const mockGetDashboardStats = vi.fn();
const mockGetMissingTopics = vi.fn();
const mockClose = vi.fn();

// Mock getKodexManager
vi.mock('../../services/kodex-manager.js', () => ({
  getKodexManager: vi.fn(() => ({
    listTopics: mockListTopics,
    getTopic: mockGetTopic,
    createTopic: mockCreateTopic,
    updateTopic: mockUpdateTopic,
    deleteTopic: mockDeleteTopic,
    verifyTopic: mockVerifyTopic,
    listDrafts: mockListDrafts,
    approveDraft: mockApproveDraft,
    rejectDraft: mockRejectDraft,
    listFlags: mockListFlags,
    updateFlagStatus: mockUpdateFlagStatus,
    createFlag: mockCreateFlag,
    getDashboardStats: mockGetDashboardStats,
    getMissingTopics: mockGetMissingTopics,
    close: mockClose,
  })),
}));

// Helper to create mock topics
function createMockTopic(name: string, title: string, includeContent: boolean = false): any {
  const topic: TopicMetadata = {
    name,
    title,
    confidence: 'high',
    verified: false,
    verifiedAt: null,
    verifiedBy: null,
    createdAt: '2024-01-28T00:00:00Z',
    updatedAt: '2024-01-28T00:00:00Z',
    hasDraft: false,
    aliases: [],
  };

  if (includeContent) {
    return {
      ...topic,
      content: {
        conceptual: 'Conceptual overview',
        technical: 'Technical details',
        files: 'Related files',
        related: 'Related topics'
      }
    };
  }

  return topic;
}

describe('Kodex API - GET /topics endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('without includeContent parameter', () => {
    it('should return topics without content by default', async () => {
      // Arrange
      const mockTopic = createMockTopic('test-topic', 'Test Topic', false);
      mockListTopics.mockResolvedValue([mockTopic]);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).not.toHaveProperty('content');
      expect(data[0].name).toBe('test-topic');
    });

    it('should return empty array when no topics exist', async () => {
      // Arrange
      mockListTopics.mockResolvedValue([]);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(0);
    });
  });

  describe('with includeContent=true parameter', () => {
    it('should return topics with full content', async () => {
      // Arrange
      const mockMetadata = createMockTopic('test-topic', 'Test Topic', false);
      const mockTopicWithContent = createMockTopic('test-topic', 'Test Topic', true);

      mockListTopics.mockResolvedValue([mockMetadata]);
      mockGetTopic.mockResolvedValue(mockTopicWithContent);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project&includeContent=true', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);

      const topic = data[0];
      expect(topic).toHaveProperty('name');
      expect(topic).toHaveProperty('title');
      expect(topic).toHaveProperty('content');
      expect(topic.content).toHaveProperty('conceptual');
      expect(topic.content).toHaveProperty('technical');
      expect(topic.content).toHaveProperty('files');
      expect(topic.content).toHaveProperty('related');

      expect(topic.content.conceptual).toBe('Conceptual overview');
      expect(topic.content.technical).toBe('Technical details');
      expect(topic.content.files).toBe('Related files');
      expect(topic.content.related).toBe('Related topics');
    });

    it('should return multiple topics with content', async () => {
      // Arrange
      const metadata1 = createMockTopic('topic-1', 'First Topic', false);
      const metadata2 = createMockTopic('topic-2', 'Second Topic', false);
      const topic1WithContent = createMockTopic('topic-1', 'First Topic', true);
      const topic2WithContent = createMockTopic('topic-2', 'Second Topic', true);

      mockListTopics.mockResolvedValue([metadata1, metadata2]);
      mockGetTopic
        .mockResolvedValueOnce(topic1WithContent)
        .mockResolvedValueOnce(topic2WithContent);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project&includeContent=true', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(2);

      // All topics should have content
      for (const topic of data) {
        expect(topic).toHaveProperty('content');
        expect(topic.content).toHaveProperty('conceptual');
        expect(topic.content).toHaveProperty('technical');
      }
    });
  });

  describe('with includeContent=false parameter', () => {
    it('should return topics without content when explicitly set to false', async () => {
      // Arrange
      const mockTopic = createMockTopic('test-topic', 'Test Topic', false);
      mockListTopics.mockResolvedValue([mockTopic]);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project&includeContent=false', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0]).toHaveProperty('name');
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).not.toHaveProperty('content');
    });
  });

  describe('error handling', () => {
    it('should return 400 when project parameter is missing', async () => {
      // Arrange
      const req = new Request('http://localhost/api/kodex/topics', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);

      // Assert
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data).toHaveProperty('error');
      expect(data.error).toContain('project');
    });

    it('should handle case-insensitive includeContent parameter', async () => {
      // Arrange
      const mockMetadata = createMockTopic('test-topic', 'Test Topic', false);
      const mockTopicWithContent = createMockTopic('test-topic', 'Test Topic', true);

      mockListTopics.mockResolvedValue([mockMetadata]);
      mockGetTopic.mockResolvedValue(mockTopicWithContent);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project&includeContent=TRUE', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();

      // Assert - TRUE (uppercase) should be treated as truthy
      expect(response.status).toBe(200);
      expect(data[0]).toHaveProperty('content');
    });

    it('should treat non-true values as false for includeContent', async () => {
      // Arrange
      const mockTopic = createMockTopic('test-topic', 'Test Topic', false);
      mockListTopics.mockResolvedValue([mockTopic]);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project&includeContent=yes', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();

      // Assert - "yes" should not be treated as true
      expect(response.status).toBe(200);
      expect(data[0]).not.toHaveProperty('content');
    });
  });

  describe('response structure', () => {
    it('should include all required metadata fields without content', async () => {
      // Arrange
      const mockTopic = createMockTopic('test-topic', 'Test Topic', false);
      mockListTopics.mockResolvedValue([mockTopic]);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();
      const topic = data[0];

      // Assert
      expect(topic).toHaveProperty('name');
      expect(topic).toHaveProperty('title');
      expect(topic).toHaveProperty('confidence');
      expect(topic).toHaveProperty('verified');
      expect(topic).toHaveProperty('verifiedAt');
      expect(topic).toHaveProperty('verifiedBy');
      expect(topic).toHaveProperty('createdAt');
      expect(topic).toHaveProperty('updatedAt');
      expect(topic).toHaveProperty('hasDraft');
      expect(topic).toHaveProperty('aliases');
    });

    it('should return ISO timestamp format', async () => {
      // Arrange
      const mockTopic = createMockTopic('test-topic', 'Test Topic', false);
      mockListTopics.mockResolvedValue([mockTopic]);

      const req = new Request('http://localhost/api/kodex/topics?project=/test/project', { method: 'GET' });

      // Act
      const response = await handleKodexAPI(req);
      const data = await response.json();
      const topic = data[0];

      // Assert
      expect(topic.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(topic.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
