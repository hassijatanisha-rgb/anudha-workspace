# Anudha ERP — current two-workflow scope

The current workflow scope contains exactly two connected workflows: sales and service.

## 1. Sales workflow

1. A sales employee creates a draft and may issue revisions.
2. The customer records acceptance of the selected revision.
3. The Pro forma is marked **Submitted**.
4. Accounts marks the Pro forma **Approved**.
5. A tax invoice is created.
6. The work is sent to the downstairs sales/packing queue.
7. Packing is marked **In progress**.
8. The order is marked **Ready for delivery**.
9. The order is marked **Out for delivery**.
10. A signed delivery note completes delivery.

Every transition records the responsible employee and timestamp. Pro forma invoices, tax invoices and delivery notes are retained as PDFs, including the accepted or signed document where applicable. Accounts role restrictions are deferred and are not part of the current workflow implementation scope.

## 2. Service workflow

1. A signed machine delivery creates an installation record.
2. The Head of Department (HOD) assigns the installation.
3. The assigned employee completes the installation and its report.
4. Installation completion creates the machine maintenance schedule.
5. The HOD assigns each service visit.
6. The assigned employee completes the service visit and its report.

Every transition records the responsible employee and timestamp. Installation and service reports use immutable saved snapshots and can be printed to the official one-page PDF layouts. Signed-document references are retained; private evidence-file storage remains a server-week task.

## Explicitly out of current workflow scope

Purchasing, general ledger, suppliers and returns are outside the current workflow scope. Their screens, data foundations or future-readiness notes must not be interpreted as active connected workflows.
