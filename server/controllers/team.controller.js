"use strict";

const Team = require("../models/Team");
const Operator = require("../models/Operator");
const asyncHandler = require("../utils/asyncHandler");
const AppError = require("../utils/AppError");

// @desc    Create a new team
// @route   POST /api/v1/teams
exports.createTeam = asyncHandler(async (req, res, next) => {
  const { teamName, description, teamLeadId, memberIds, isActive, remark } = req.body;

  const exists = await Team.findOne({ teamName: { $regex: new RegExp(`^${teamName}$`, "i") } });
  if (exists) {
    return next(new AppError("Team name already exists", 400));
  }

  const team = await Team.create({ teamName, description, teamLeadId: teamLeadId || undefined, memberIds, isActive, remark });

  // Sync Operator teamIds
  const allEmployeesInTeam = [teamLeadId, ...(memberIds || [])].filter(Boolean);
  await Operator.updateMany(
    { _id: { $in: allEmployeesInTeam } },
    { $addToSet: { teamIds: team._id } }
  );

  res.status(201).json({ isOk: true, data: team, message: "Team created successfully" });
});

// @desc    Get all teams (simple list)
// @route   GET /api/v1/teams
exports.getAllTeams = asyncHandler(async (req, res, next) => {
  const { isActive } = req.query;
  const filter = {};
  if (isActive !== undefined) filter.isActive = isActive === "true";

  const teams = await Team.find(filter)
    .populate("teamLeadId", "employeeName profilePic")
    .populate({
      path: "memberIds",
      select: "employeeName profilePic roleId isActive reportingManagerIds",
      populate: { path: "roleId", select: "roleName" },
    })
    .sort({ createdAt: -1 })
    .lean();

  res.status(200).json({ isOk: true, data: teams });
});

// @desc    Get single team
// @route   GET /api/v1/teams/:id
exports.getTeam = asyncHandler(async (req, res, next) => {
  const team = await Team.findById(req.params.id)
    .populate("teamLeadId", "employeeName profilePic")
    .populate("memberIds", "employeeName profilePic")
    .lean();

  if (!team) return next(new AppError("Team not found", 404));

  res.status(200).json({ isOk: true, data: team });
});

// @desc    Update a team
// @route   PUT /api/v1/teams/:id
exports.updateTeam = asyncHandler(async (req, res, next) => {
  const { teamName, description, teamLeadId, memberIds, isActive, remark } = req.body;

  const team = await Team.findById(req.params.id);
  if (!team) return next(new AppError("Team not found", 404));

  if (teamName && teamName.toLowerCase() !== team.teamName.toLowerCase()) {
    const exists = await Team.findOne({ teamName: { $regex: new RegExp(`^${teamName}$`, "i") } });
    if (exists) return next(new AppError("Team name already exists", 400));
  }

  const oldEmployeesInTeam = [team.teamLeadId, ...(team.memberIds || [])].filter(Boolean);

  if (teamName !== undefined) team.teamName = teamName;
  if (description !== undefined) team.description = description;
  if (teamLeadId !== undefined) team.teamLeadId = teamLeadId || null;
  if (memberIds !== undefined) team.memberIds = memberIds;
  if (isActive !== undefined) team.isActive = isActive;
  if (remark !== undefined) team.remark = remark;

  await team.save();

  // Sync Operator teamIds
  const newEmployeesInTeam = [team.teamLeadId, ...(team.memberIds || [])].filter(Boolean);
  
  // Remove team from old members
  await Operator.updateMany(
    { _id: { $in: oldEmployeesInTeam } },
    { $pull: { teamIds: team._id } }
  );
  
  // Add team to new members
  await Operator.updateMany(
    { _id: { $in: newEmployeesInTeam } },
    { $addToSet: { teamIds: team._id } }
  );

  await team.populate("teamLeadId", "employeeName profilePic");
  await team.populate("memberIds", "employeeName profilePic");

  res.status(200).json({ isOk: true, data: team, message: "Team updated successfully" });
});

// @desc    Delete a team
// @route   DELETE /api/v1/teams/:id
exports.deleteTeam = asyncHandler(async (req, res, next) => {
  const team = await Team.findById(req.params.id);
  if (!team) return next(new AppError("Team not found", 404));

  if (team.isActive) {
    team.isActive = false;
    await team.save();
    return res.status(200).json({ isOk: true, message: "Team deactivated successfully" });
  } else {
    await team.deleteOne();
    return res.status(200).json({ isOk: true, message: "Team deleted successfully" });
  }
});

// @desc    Search/paginate teams
// @route   POST /api/v1/teams/search
exports.searchTeams = asyncHandler(async (req, res, next) => {
  const { skip = 0, per_page = 10, sorton, sortdir, match, isActive } = req.body;

  let query = {};
  if (match) {
    query.$or = [
      { teamName: { $regex: match, $options: "i" } },
      { description: { $regex: match, $options: "i" } },
    ];
  }
  if (isActive !== undefined) query.isActive = isActive;

  let sortQuery = { createdAt: -1 };
  if (sorton && sortdir) sortQuery = { [sorton]: sortdir === "desc" ? -1 : 1 };

  const [totalCount, teams] = await Promise.all([
    Team.countDocuments(query),
    Team.find(query)
      .populate("teamLeadId", "employeeName profilePic")
      .populate("memberIds", "employeeName")
      .sort(sortQuery)
      .skip(parseInt(skip))
      .limit(parseInt(per_page))
      .lean(),
  ]);

  res.status(200).json({
    isOk: true,
    data: [{ count: totalCount, data: teams }],
  });
});
