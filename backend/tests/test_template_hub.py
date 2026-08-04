import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from database.models import UserAccount
from database.session import Base
from routes.template_hub import (
    CommentRequest,
    PublishTemplateRequest,
    RatingRequest,
    add_comment,
    delete_template,
    install_template,
    list_templates,
    publish_template,
    rate_template,
)


def workflow_payload(name: str = "团队研究流") -> dict:
    return {
        "id": "custom-team-research",
        "name": name,
        "category": "研究",
        "description": "可复用的团队研究模板",
        "iconKey": "custom",
        "accent": "#5B7CFF",
        "target": "chat",
        "fields": [{"key": "topic", "label": "主题", "type": "textarea", "required": True}],
        "steps": [
            {"id": "frame", "title": "定义问题", "description": "确定边界"},
            {"id": "analyze", "title": "分析证据", "description": "建立证据链"},
            {"id": "deliver", "title": "输出结果", "description": "形成行动建议"},
        ],
        "promptTemplate": "围绕 {{topic}} 完成研究，并给出证据、风险与下一步。",
        "custom": True,
    }


class TemplateHubTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.db = sessionmaker(bind=engine)()
        self.owner = UserAccount(
            username="owner",
            name="模板作者",
            email="owner@example.com",
            password_hash="test",
            role="member",
            is_active=True,
        )
        self.member = UserAccount(
            username="member",
            name="团队成员",
            email="member@example.com",
            password_hash="test",
            role="member",
            is_active=True,
        )
        self.db.add_all([self.owner, self.member])
        self.db.commit()
        self.db.refresh(self.owner)
        self.db.refresh(self.member)

    def tearDown(self) -> None:
        self.db.close()

    def publish(self):
        return publish_template(
            PublishTemplateRequest(workflow=workflow_payload(), releaseNotes="首个可用版本"),
            self.db,
            self.owner,
        )

    def test_publish_list_interact_and_install(self) -> None:
        published = self.publish()
        template_id = published["id"]

        rated = rate_template(template_id, RatingRequest(value=5), self.db, self.member)
        self.assertEqual(rated["ratingAverage"], 5.0)
        commented = add_comment(template_id, CommentRequest(body="适合周度研究会。"), self.db, self.member)
        installed = install_template(template_id, self.db, self.member)

        self.assertEqual(commented["comment"]["username"], "member")
        self.assertEqual(installed["installCount"], 1)
        listed = list_templates("研究", "chat", "rating", self.db, self.member)
        self.assertEqual(listed["total"], 1)
        self.assertEqual(listed["items"][0]["myRating"], 5)

    def test_republish_updates_snapshot_and_keeps_feedback(self) -> None:
        published = self.publish()
        template_id = published["id"]
        rate_template(template_id, RatingRequest(value=4), self.db, self.member)

        updated = publish_template(
            PublishTemplateRequest(workflow=workflow_payload("团队研究流 2.0"), releaseNotes="补强交付结构"),
            self.db,
            self.owner,
        )

        self.assertEqual(updated["id"], template_id)
        self.assertEqual(updated["workflow"]["name"], "团队研究流 2.0")
        self.assertEqual(updated["ratingCount"], 1)

    def test_only_owner_or_admin_can_delete(self) -> None:
        published = self.publish()
        with self.assertRaises(HTTPException) as raised:
            delete_template(published["id"], self.db, self.member)
        self.assertEqual(raised.exception.status_code, 403)

        result = delete_template(published["id"], self.db, self.owner)
        self.assertTrue(result["ok"])


if __name__ == "__main__":
    unittest.main()

