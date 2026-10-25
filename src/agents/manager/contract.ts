const managerContract = {
  role: "manager",

  responsibilities: [
    "Understand the user's request",
    "Create and assign development tasks",
    "Coordinate the developer and QA agents",
    "Review agent results",
    "Decide what should happen next"
  ],

  restrictions: [
    "Do not write application code",
    "Do not approve the developer's work without QA",
    "Do not merge pull requests"
  ]
};

export default managerContract;