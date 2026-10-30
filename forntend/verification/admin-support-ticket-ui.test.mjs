import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { hookHarness } from './componentHarness.mjs';

test('Support ticket cards and modal display Requester Name, Category, and Subject without Assign to Me button', async () => {
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom' });
  try {
    const TicketsTabModule = await vite.ssrLoadModule('/src/modules/Admin/components/TicketsTab.jsx');
    const TicketsTab = TicketsTabModule.default || TicketsTabModule.TicketsTab;

    const mockTicket = {
      id: 'ticket-101',
      ticketNumber: 'NHC-10101',
      userName: 'Rahul Verma',
      userEmail: 'rahul@example.com',
      requesterRole: 'customer',
      category: 'Order Issue',
      subject: 'Damaged item received',
      desc: 'The box was torn and items damaged.',
      status: 'OPEN',
      date: '28 Oct 2026',
    };

    let openedTicket = null;
    const mockContext = {
      tickets: [mockTicket],
      ticketsLoading: false,
      ticketsError: '',
      fetchTickets: () => {},
      ticketCategoryFilter: 'All',
      setTicketCategoryFilter: () => {},
      ticketRoleFilter: 'All',
      setTicketRoleFilter: () => {},
      selectedTicket: null,
      setSelectedTicket: (t) => {},
      ticketDetail: null,
      ticketMessages: [],
      ticketDetailLoading: false,
      openTicketDetail: (t) => { openedTicket = t; },
      replyToTicket: () => {},
      addInternalNote: () => {},
      changeTicketStatus: () => {},
      resolveTicket: () => {},
      ticketReply: '',
      setTicketReply: () => {},
      searchQuery: '',
      setSearchQuery: () => {},
      filterStatus: 'All',
      setFilterStatus: () => {},
    };

    // 1. Test ticket card rendering in TicketsTab list
    const harness = hookHarness(TicketsTab, {}, '/admin/tickets', mockContext);
    try {
      const subjectNode = harness.find((n) => n.type === 'h4' && n.props?.children === 'Damaged item received');
      assert.ok(subjectNode, 'Subject must be displayed on ticket card');

      const requesterNode = harness.find((n) => n.props?.className === 'admin-item-value' && n.props?.children?.[0]?.props?.children === 'Rahul Verma');
      assert.ok(requesterNode, 'Requester name must be displayed on ticket card');

      const categoryNode = harness.find((n) => n.props?.className === 'admin-item-value' && n.props?.children === 'Order Issue');
      assert.ok(categoryNode, 'Category must be displayed on ticket card');

      // Verify "Assigned To" is NOT present anywhere on the card
      const assignedLabel = harness.find((n) => n.props?.className === 'admin-item-label' && n.props?.children === 'Assigned To');
      assert.strictEqual(assignedLabel, undefined, 'Assigned To field must be removed from ticket card');
    } finally {
      harness.close?.();
    }

    // 2. Test ticket detail modal rendering with activeTicket
    const mockContextWithModal = {
      ...mockContext,
      selectedTicket: mockTicket,
      ticketDetail: {
        _id: 'ticket-101',
        ticketNumber: 'NHC-10101',
        userName: 'Rahul Verma',
        userEmail: 'rahul@example.com',
        requesterRole: 'customer',
        category: 'Order Issue',
        subject: 'Damaged item received',
        status: 'OPEN',
      },
    };

    const modalHarness = hookHarness(TicketsTab, {}, '/admin/tickets', mockContextWithModal);
    try {
      // Modal title
      const modalTitle = modalHarness.find((n) => n.props?.className?.includes?.('admin-modal-title'));
      assert.ok(modalTitle, 'Modal title should be present');

      // Requester in modal
      const modalRequester = modalHarness.find((n) => n.props?.className?.includes?.('ticket-user-name') || n.props?.children?.[0] === 'Rahul Verma' || n.props?.children === 'Rahul Verma');
      assert.ok(modalRequester, 'Requester name must be present in modal');

      // Category in modal
      const modalCategory = modalHarness.find((n) => (n.props?.className?.includes?.('admin-item-value') || n.props?.className?.includes?.('ticket-category-tag')) && (n.props?.children === 'Order Issue' || n.props?.children?.[1] === 'Order Issue'));
      assert.ok(modalCategory, 'Category must be present in modal');

      // Subject in modal
      const modalSubject = modalHarness.find((n) => n.props?.className?.includes?.('ticket-subject-text') && (n.props?.children === 'Damaged item received' || n.props?.children?.[0] === 'Damaged item received'));
      assert.ok(modalSubject, 'Subject must be present in modal');

      // Verify "Assign to Me" / "Reassign to Me" button is NOT present in modal actions
      const assignButton = modalHarness.find((n) => n.type === 'button' && (n.props?.children === 'Assign to Me' || n.props?.children === 'Reassign to Me'));
      assert.strictEqual(assignButton, undefined, 'Assign to Me button must be removed from modal');
    } finally {
      modalHarness.close?.();
    }
  } finally {
    await vite.close();
  }
});
